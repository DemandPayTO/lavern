/**
 * Authentication Middleware — Dual auth for API clients + browser users.
 *
 * Two authentication paths:
 * 1. Bearer token (API clients / agents): Authorization: Bearer shem_agent_abc123...
 * 2. Cookie (browser users): starling_token=<token> (HttpOnly, set by /api/auth/login)
 *
 * If neither is present and the path isn't public, returns 401.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'node:crypto';
import type { ClientIdentity } from '../../types/client.js';
import { createClientIdentity, generateApiKey } from '../../types/client.js';
import { CreateClientSchema, validateBody, type CreateClientBody } from './validation.js';
import { isUrlSafe } from '../../utils/url-safety.js';
import { getUserByToken as dbGetUserByToken, saveApiClient, getApiClientByKeyHash, getAllApiClients, removeApiClient as dbRemoveApiClient, updateApiClientLastActive } from '../../db/database.js';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('AUTH');

/**
 * SQLite-backed client registry with in-memory cache for fast lookups.
 * Survives server restarts — clients are loaded from DB on construction.
 */
export class ClientRegistry {
  private clients = new Map<string, ClientIdentity>();
  private keyHashToClientId = new Map<string, string>();
  private _loaded = false;

  /**
   * Load all clients from SQLite into memory cache.
   * Call this after initDatabase() during server startup.
   */
  loadFromDb(): void {
    if (this._loaded) return;
    try {
      const dbClients = getAllApiClients();
      for (const row of dbClients) {
        try {
          const client: ClientIdentity = {
            type: row.type as 'human' | 'agent',
            id: row.id,
            name: row.name || undefined,
            apiKeyHash: row.api_key_hash,
            callbackUrl: row.callback_url || undefined,
            autoApproveThreshold: row.auto_approve_threshold ?? undefined,
            capabilities: JSON.parse(row.capabilities || '[]'),
            registeredAt: row.created_at,
            lastActiveAt: row.last_active_at || undefined,
          };
          this.clients.set(client.id, client);
          this.keyHashToClientId.set(row.api_key_hash, client.id);
        } catch {
          logger.warn('Skipping corrupt client row', { id: row.id });
        }
      }
      if (dbClients.length > 0) {
        logger.info(`Loaded ${dbClients.length} API client${dbClients.length === 1 ? '' : 's'} from database`);
      }
    } catch {
      // DB not initialized yet — that's OK, we'll work in-memory only
      logger.info('Database not available — client registry running in-memory only');
    }
    this._loaded = true;
  }

  /**
   * Register a new client and return their API key.
   * Persists to SQLite so it survives restarts.
   */
  registerClient(
    type: ClientIdentity['type'],
    options?: {
      name?: string;
      callbackUrl?: string;
      autoApproveThreshold?: number;
      capabilities?: string[];
    }
  ): { client: ClientIdentity; apiKey: string } {
    const id = `client-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const apiKey = generateApiKey(type);
    const keyHash = hashApiKey(apiKey);

    const client = createClientIdentity(type, id, {
      name: options?.name,
      callbackUrl: options?.callbackUrl,
      autoApproveThreshold: options?.autoApproveThreshold,
      capabilities: options?.capabilities,
      apiKeyHash: keyHash,
    });

    // Persist to SQLite. At-most-once: if the write fails (DB locked,
    // schema drift, disk full), the client stays in memory and serves
    // the current process, but disappears on restart. That's a
    // deliberate availability trade-off — we'd rather lose persistence
    // than fail registration during a transient DB hiccup. Caller is
    // documented to treat persistence as best-effort.
    try {
      saveApiClient({
        id: client.id,
        type: client.type,
        name: client.name || '',
        apiKeyHash: keyHash,
        callbackUrl: client.callbackUrl,
        autoApproveThreshold: client.autoApproveThreshold,
        capabilities: client.capabilities,
        registeredAt: client.registeredAt,
      });
    } catch (err) {
      // Demoted from error to warn: not a system failure, just a
      // single-process degradation. Test fixtures and tests that
      // don't init the DB legitimately hit this path.
      logger.warn('Client not persisted to DB; lives in-memory only', { clientId: client.id, error: err });
    }

    // Update memory cache
    this.clients.set(id, client);
    this.keyHashToClientId.set(keyHash, id);

    return { client, apiKey };
  }

  /**
   * Authenticate a client by API key.
   * Checks memory cache first, falls back to SQLite for keys created before this boot.
   */
  authenticate(apiKey: string): ClientIdentity | null {
    const keyHash = hashApiKey(apiKey);

    // Fast path: memory cache
    let clientId = this.keyHashToClientId.get(keyHash);
    if (clientId) {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastActiveAt = new Date().toISOString();
        // Async update — fire and forget (don't slow down auth)
        try { updateApiClientLastActive(client.id); } catch { /* best effort */ }
        return client;
      }
    }

    // Slow path: check SQLite (for clients registered before cache was loaded)
    try {
      const row = getApiClientByKeyHash(keyHash);
      if (row) {
        const client: ClientIdentity = {
          type: row.type as 'human' | 'agent',
          id: row.id,
          name: row.name || undefined,
          apiKeyHash: row.api_key_hash,
          callbackUrl: row.callback_url || undefined,
          autoApproveThreshold: row.auto_approve_threshold ?? undefined,
          capabilities: JSON.parse(row.capabilities || '[]'),
          registeredAt: row.created_at,
          lastActiveAt: new Date().toISOString(),
        };
        // Populate cache
        this.clients.set(client.id, client);
        this.keyHashToClientId.set(keyHash, client.id);
        try { updateApiClientLastActive(client.id); } catch { /* best effort */ }
        return client;
      }
    } catch { /* DB not ready */ }

    return null;
  }

  getClient(id: string): ClientIdentity | null {
    return this.clients.get(id) || null;
  }

  getAllClients(): ClientIdentity[] {
    return [...this.clients.values()];
  }

  removeClient(id: string): boolean {
    const client = this.clients.get(id);
    if (!client) return false;

    // Remove from SQLite
    try { dbRemoveApiClient(id); } catch { /* best effort */ }

    if (client.apiKeyHash) {
      this.keyHashToClientId.delete(client.apiKeyHash);
    }
    this.clients.delete(id);
    return true;
  }
}

/**
 * Hash an API key for storage.
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Parse the auth token from a cookie header string.
 * Accepts starling_token; falls back to the legacy lavern_token so
 * sessions issued before the rebrand stay valid until they expire.
 */
export function parseCookieToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  const match = cookies.find(c => c.trim().startsWith('starling_token='))
    ?? cookies.find(c => c.trim().startsWith('lavern_token='));
  if (!match) return null;
  const idx = match.indexOf('=');
  return idx >= 0 ? match.slice(idx + 1).trim() || null : null;
}

/**
 * Create authentication middleware that validates Bearer tokens.
 * Returns a Fastify onRequest hook.
 *
 * Public path format:
 *   '/health'               — exact match, any method
 *   '/dashboard/'           — prefix match (trailing / + length > 1), any method
 *   'GET /api/sessions'     — exact match, GET only
 *   'GET /api/sessions/*'   — prefix match, GET only (trailing *)
 */
export function createAuthMiddleware(
  registry: ClientRegistry,
  publicPaths: string[] = ['/health', '/'],
): (request: FastifyRequest, reply: FastifyReply) => Promise<void | FastifyReply> {
  // Pre-compute public path matchers for fast lookup
  const exactPaths = new Set<string>();
  const prefixPaths: Array<{ method?: string; prefix: string }> = [];
  const methodExactPaths = new Map<string, Set<string>>();

  for (const p of publicPaths) {
    const spaceIdx = p.indexOf(' ');
    if (spaceIdx > 0) {
      // Method-scoped: 'GET /api/sessions' or 'GET /api/sessions/*'
      const method = p.slice(0, spaceIdx).toUpperCase();
      const path = p.slice(spaceIdx + 1);
      if (path.endsWith('*')) {
        prefixPaths.push({ method, prefix: path.slice(0, -1) });
      } else {
        if (!methodExactPaths.has(method)) methodExactPaths.set(method, new Set());
        methodExactPaths.get(method)!.add(path);
      }
    } else if (p.endsWith('/') && p.length > 1) {
      // Prefix match: '/dashboard/'
      prefixPaths.push({ prefix: p });
    } else {
      // Exact match: '/health'
      exactPaths.add(p);
    }
  }

  function isPublic(method: string, url: string): boolean {
    if (exactPaths.has(url)) return true;
    const methodUpper = method.toUpperCase();
    if (methodExactPaths.get(methodUpper)?.has(url)) return true;
    for (const pp of prefixPaths) {
      if (pp.method && pp.method !== methodUpper) continue;
      if (url.startsWith(pp.prefix)) return true;
    }
    return false;
  }

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as FastifyRequest & {
      userId?: string;
      firmId?: string;
      user?: { id: string; email: string; displayName: string; firmId?: string };
    };

    // LOCAL MODE: bypass all auth, inject synthetic local user
    if (!config.authEnabled) {
      req.userId = 'local-user';
      req.firmId = 'local-firm';
      req.user = { id: 'local-user', email: 'local@localhost', displayName: 'Local User', firmId: 'local-firm' };
      return;
    }

    /** Attach identity from Bearer token or cookie if present. Returns true when attached. */
    const attachIdentity = (): boolean => {
      // Path 1: Bearer token (API clients / agents)
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const client = registry.authenticate(token);
        if (client) {
          req.userId = client.id;
          req.user = { id: client.id, email: '', displayName: client.name ?? '' };
          return true;
        }
      }
      // Path 2: Cookie (browser users)
      const cookieToken = parseCookieToken(request.headers.cookie);
      if (cookieToken) {
        const user = dbGetUserByToken(cookieToken);
        if (user) {
          req.userId = user.id;
          req.firmId = user.firm_id ?? user.firm_name ?? undefined;
          req.user = { id: user.id, email: user.email, displayName: user.display_name ?? '', firmId: user.firm_id ?? user.firm_name ?? undefined };
          return true;
        }
      }
      return false;
    };

    // Public paths: skip auth ENFORCEMENT (anonymous callers allowed), but
    // still attach identity when valid credentials are presented. Routes
    // under public wildcards run their own checkSessionOwnership() — that
    // check needs the identity. Before this, an authenticated user's cookie
    // was IGNORED on public paths, so DELETE /api/sessions/:id (public for
    // the QuickStart flow) 404'd on the user's own sessions: ownership saw
    // session.userId set but request.userId undefined.
    if (isPublic(request.method, request.url.split('?')[0])) {
      attachIdentity(); // best-effort — never 401 on a public path
      return;
    }

    if (attachIdentity()) return;

    // No valid auth — 401
    return reply.status(401).send({ error: 'Unauthorized' });
  };
}

/**
 * Register authentication routes.
 */
export function registerAuthRoutes(
  fastify: FastifyInstance,
  registry: ClientRegistry
): void {
  // POST /api/clients — Register a new client
  fastify.post('/api/clients', async (request, reply) => {
    // Validate request body
    const body = validateBody<CreateClientBody>(CreateClientSchema, request, reply);
    if (!body) return; // 400 already sent

    // SSRF prevention — validate callbackUrl points to a public host before
    // we store it. Otherwise an attacker can register a client with
    // callbackUrl=http://169.254.169.254/... and use any webhook-mode
    // session as a metadata-service exfil channel.
    if (body.callbackUrl && !isUrlSafe(body.callbackUrl)) {
      return reply.status(400).send({
        error: 'Invalid callbackUrl',
        details: 'callbackUrl must be an HTTPS URL pointing to a public host. Private IPs, localhost, and link-local addresses are blocked.',
      });
    }

    const { client, apiKey } = registry.registerClient(body.type, {
      name: body.name,
      callbackUrl: body.callbackUrl,
      autoApproveThreshold: body.autoApproveThreshold,
      capabilities: body.capabilities,
    });

    return reply.status(201).send({
      clientId: client.id,
      type: client.type,
      name: client.name,
      apiKey, // Only returned once at registration
      message: 'Store this API key securely — it will not be shown again.',
    });
  });

  // GET /api/clients/:id — Get client info (no API key)
  fastify.get('/api/clients/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = registry.getClient(id);

    if (!client) {
      return reply.status(404).send({ error: `Client not found: ${id}` });
    }

    return reply.send({
      id: client.id,
      type: client.type,
      name: client.name,
      registeredAt: client.registeredAt,
      lastActiveAt: client.lastActiveAt,
      capabilities: client.capabilities,
      hasCallbackUrl: !!client.callbackUrl,
    });
  });

  // GET /api/clients — List all clients
  fastify.get('/api/clients', async (_request, reply) => {
    const clients = registry.getAllClients();
    return reply.send({
      clients: clients.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        registeredAt: c.registeredAt,
        lastActiveAt: c.lastActiveAt,
      })),
      total: clients.length,
    });
  });
}
