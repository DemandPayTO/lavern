# Incident Response Plan

**Owner:** DemandPay principal. **Last reviewed:** 2026-08-14.

A small-team, pilot-stage plan for responding to a security incident. The goal
is to act fast and correctly on the thing that matters most for this product:
**any suspected exposure of confidential legal matter data.**

---

## 1. What counts as an incident

- Suspected or confirmed **cross-tenant data access** (a firm sees another
  firm's matters).
- **Auth bypass** or a server running public without auth.
- **Secret exposure** (an API key, session secret, or DB credential leaked).
- **Data exfiltration** or unexpected outbound transfer of matter data.
- **Integrity compromise** — data altered by an unauthorised party.
- A **dependency or platform vulnerability** being actively exploited.
- Loss of availability affecting client work (extended outage, data loss).

A suspected exposure of Restricted data (see
`data-classification-and-retention.md`) is **priority one**.

## 2. Roles (pilot scale)

At present the principal is Incident Commander, responder, and communicator.
As the team grows, name a deputy commander and a communications lead.

## 3. Response steps

1. **Detect & declare.** Anyone noticing a suspected incident declares it to
   the Incident Commander immediately. Note the time and what was observed.
2. **Contain.** Stop the bleeding first:
   - Cross-tenant or auth issue → take the affected surface offline
     (`fly scale count 0` or a maintenance page) rather than let exposure
     continue.
   - Secret exposure → rotate the secret immediately (Fly secrets / provider
     console) and invalidate sessions if session-related.
   - Malicious traffic → tighten rate limits / block at the edge.
3. **Assess.** Determine scope: what data, whose data, over what window. Use
   the request logs (method/URL/status), `last_modified_by`, timeline events,
   and the Claw audit trail. Preserve evidence — do not delete logs.
4. **Eradicate & fix.** Patch the root cause under the normal test discipline
   (three clean passes both suites) before redeploying. Add a regression test
   that would have caught it.
5. **Recover.** Restore service; if data integrity was affected, restore from
   backup (`src/db/backup.ts`; restore drill in
   `docs/ops/restore-drill-2026-07-14.md`) and verify.
6. **Notify.** If confidential client data was or may have been exposed,
   notify the affected firm(s) promptly and honestly, and assess obligations
   under PIPEDA (including the Privacy Commissioner where a real risk of
   significant harm exists) and the firm's own professional-conduct duties.
   Legal/regulatory notification is a decision for the principal with counsel.
7. **Review.** Within a week, write a short blameless post-incident review:
   timeline, root cause, what worked, what to change. File it under
   `docs/ops/`.

## 4. Contacts and escalation

- **Incident Commander:** DemandPay principal.
- **Hosting:** Fly.io support / dashboard.
- **LLM providers:** Anthropic / Mistral consoles for key rotation and abuse.
- **Affected firms:** the pilot lawyer contact(s) on record.

Maintain a current list of these contacts out of band (not only in this repo).

## 5. Preparation (keep these ready)

- Backups running and restore drill-tested (done: 2026-07-14).
- The deploy guard prevents the worst self-inflicted incident (public no-auth).
- Rate limits and the load-test-bypass production lockout are in place.
- This plan is reviewed quarterly and after any real incident.

## 6. Test it

Run a tabletop exercise at least once before onboarding real client data:
walk through a simulated cross-tenant exposure end to end (detect → contain →
assess → notify) and fix any gap the walkthrough reveals.
