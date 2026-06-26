/**
 * Billing Routes — Stripe-backed billable hours for DemandPay Starling.
 *
 * GET   /api/billing/balance       — User's current balance, usage, and ledger
 * POST  /api/billing/checkout      — Create Stripe Checkout session for an hour pack
 * POST  /api/billing/webhook       — Stripe webhook handler (signature-verified)
 * POST  /api/billing/admin-credit  — Manually credit hours (X-Admin-Key gated)
 *
 * Gated on config.authEnabled — only registers when multi-user auth is active.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { config } from '../../config.js';
import {
  getUserBillableHours,
  getUserMonthlyUsage,
  getBillableHoursHistory,
  getUserPlan,
  setUserStripeCustomer,
  creditBillableHours,
  recordBillingEvent,
  isStripeEventProcessed,
  getUserById,
  logAuditEvent,
} from '../../db/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('BILLING');

// ── Schemas ──────────────────────────────────────────────────────────────

const CheckoutSchema = z.object({
  packId: z.enum(['quick', 'standard', 'bulk']),
});

const AdminCreditSchema = z.object({
  userId: z.string().min(1),
  hours: z.number().positive().max(10000),
  description: z.string().min(1).max(500),
});

// ── Route Registration ──────────────────────────────────────────────────

export function registerBillingRoutes(fastify: FastifyInstance): void {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Stripe client (lazy — only created if key is set)
  let stripe: Stripe | null = null;
  if (stripeKey) {
    stripe = new Stripe(stripeKey);
  }

  /**
   * GET /api/billing/balance
   * Returns user's current balance, monthly usage, and ledger history.
   */
  fastify.get('/api/billing/balance', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as FastifyRequest & { userId?: string }).userId;
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const balance = getUserBillableHours(userId);
    const usage = getUserMonthlyUsage(userId);
    const history = getBillableHoursHistory(userId, 20);

    return reply.send({
      balance,
      usage,
      history,
      packs: config.billableHours.packs,
      currency: config.billableHours.billingCurrency,
    });
  });

  /**
   * POST /api/billing/checkout
   * Creates a Stripe Checkout session for purchasing an hour pack.
   */
  fastify.post('/api/billing/checkout', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!stripe) {
      return reply.status(503).send({ error: 'Billing not configured' });
    }

    const userId = (request as FastifyRequest & { userId?: string }).userId;
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const parsed = CheckoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid pack selection' });
    }

    const { packId } = parsed.data;
    const pack = config.billableHours.packs[packId];
    if (!pack) {
      return reply.status(400).send({ error: 'Unknown pack' });
    }

    try {
      // Get or create Stripe customer
      const userPlan = getUserPlan(userId);
      let customerId = userPlan?.stripe_customer_id;

      if (!customerId) {
        const user = getUserById(userId);
        const customer = await stripe.customers.create({
          email: user?.email ?? undefined,
          metadata: { userId, platform: 'demandpay-starling' },
        });
        customerId = customer.id;
        setUserStripeCustomer(userId, customerId);
      }

      // Create Checkout session
      const appUrl = config.email?.appUrl ?? process.env.LAVERN_APP_URL ?? 'http://localhost:3000';
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'payment',
        currency: config.billableHours.billingCurrency,
        line_items: [{
          price_data: {
            currency: config.billableHours.billingCurrency,
            unit_amount: pack.priceCents,
            product_data: {
              name: `${pack.label} — ${pack.hours} hours`,
              description: `${pack.hours} billable hours for DemandPay Starling`,
            },
          },
          quantity: 1,
        }],
        metadata: {
          userId,
          packId,
          hours: String(pack.hours),
        },
        success_url: `${appUrl}/#/billing?checkout=success`,
        cancel_url: `${appUrl}/#/billing?checkout=cancelled`,
      });

      logAuditEvent({
        userId,
        action: 'billing_checkout_created',
        resource: `checkout:${session.id}`,
        ip: request.ip,
      });

      return reply.send({ url: session.url });
    } catch (err) {
      logger.error('Checkout session creation failed', err);
      return reply.status(500).send({ error: 'Failed to create checkout session' });
    }
  });

  /**
   * POST /api/billing/webhook
   * Handles Stripe webhook events. Signature-verified via rawBody.
   */
  fastify.post('/api/billing/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!stripe || !webhookSecret) {
      return reply.status(503).send({ error: 'Webhook not configured' });
    }

    const signature = request.headers['stripe-signature'] as string | undefined;
    if (!signature) {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    const rawBody = (request.raw as typeof request.raw & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      logger.error('Webhook: rawBody not captured — check preParsing hook');
      return reply.status(500).send({ error: 'Internal server error' });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      logger.warn('Webhook signature verification failed', { error: (err as Error).message });
      return reply.status(400).send({ error: 'Invalid signature' });
    }

    // Idempotency: skip already-processed events
    if (isStripeEventProcessed(event.id)) {
      return reply.send({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const packId = session.metadata?.packId;
      const hours = parseFloat(session.metadata?.hours ?? '0');

      if (!userId || !hours) {
        logger.warn('Webhook: missing metadata', { eventId: event.id });
        return reply.send({ received: true, skipped: true });
      }

      // Credit hours
      creditBillableHours(
        userId,
        hours,
        'purchase',
        `${packId ?? 'pack'} purchase — ${hours} hours`,
        null, // no expiry
        event.id,
      );

      // Record billing event
      recordBillingEvent({
        id: `be-${event.id}`,
        userId,
        type: 'purchase',
        stripeSessionId: event.id,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? config.billableHours.billingCurrency,
        metadata: { packId, hours, checkoutSessionId: session.id },
      });

      logAuditEvent({
        userId,
        action: 'billing_purchase_completed',
        resource: `event:${event.id}`,
      });

      logger.info('Purchase completed', { userId, packId, hours, eventId: event.id });
    }

    return reply.send({ received: true });
  });

  /**
   * POST /api/billing/admin-credit
   * Manually credit hours to a user. X-Admin-Key gated.
   */
  fastify.post('/api/billing/admin-credit', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminKey = (request.headers as Record<string, string>)['x-admin-key'];
    const expectedKey = config.billableHours.adminKey;
    if (!expectedKey || adminKey !== expectedKey) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const parsed = AdminCreditSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    const { userId, hours, description } = parsed.data;

    // Verify user exists
    const user = getUserById(userId);
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    creditBillableHours(userId, hours, 'admin', description);
    const newBalance = getUserBillableHours(userId);

    logAuditEvent({
      action: 'billing_admin_credit',
      resource: `user:${userId}`,
      ip: request.ip,
    });

    logger.info('Admin credit applied', { userId, hours, description, newBalance });

    return reply.send({ ok: true, userId, hours, newBalance });
  });
}
