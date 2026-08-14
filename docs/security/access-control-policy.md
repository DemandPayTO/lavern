# Access Control Policy

**Owner:** DemandPay principal. **Last reviewed:** 2026-08-14.

How identity, authentication, and authorization work in Starling, and the
rules that govern who can reach what. Grounded in the actual implementation so
a reviewer can trace each rule to code.

---

## 1. Identity and authentication

- **Users** are rows in the `users` table with a scrypt-hashed password
  (`src/db/database.ts`, `hashPassword`/`verifyPassword`, compared with
  `crypto.timingSafeEqual`). Each user belongs to a **firm** (`firm_id`).
- **Sessions** are cookie-based. On login a 32-byte random token is issued;
  only its SHA-256 hash is stored. The cookie is `HttpOnly; Path=/;
  SameSite=Lax; Max-Age=...` and carries `Secure` in production
  (`src/api/routes/auth-routes.ts`). Bearer-token auth is also supported for
  API clients.
- **Google OAuth** is available as an alternate sign-in
  (`src/api/routes/google-auth.ts`), gated with the rest of the auth surface.
- **LOCAL MODE.** When `LAVERN_AUTH_ENABLED` is not `true`, the server runs
  every request as a synthetic `local-user` in a `local-firm`
  (`src/api/middleware/auth.ts`). This is the OSS single-user default and is
  **only** safe on loopback. The boot guard (`publicNoAuthBindError`) refuses
  to start with auth off on a public interface unless
  `LAVERN_ALLOW_PUBLIC_NO_AUTH=1` is set.

## 2. Authorization model

Starling is **multi-tenant by firm**. The authorization rule is simple and
enforced in one place:

> A user may read or write a matter if they own it, or if it belongs to their
> firm.

This is the `FIRM_VISIBLE` SQL predicate in `src/db/database.ts`:
`m.user_id = ? OR (m.firm_id = (SELECT firm_id FROM users WHERE id = ?))`,
applied to every matter query and fully parameterised. Firm-scoped resources
(templates, style profiles, SOC node libraries, document reviews) carry
`firm_id NOT NULL` and are keyed by firm.

**Critical rule:** `firm_id` for any write is derived from the authenticated
session, never accepted from the request body. The legacy `/:firmId` routes
were removed because a body-supplied firm id let a caller act on another
firm's data.

## 3. Route protection

- The auth middleware (`src/api/middleware/auth.ts`) enforces a valid session
  on protected routes and returns 401 otherwise. Public paths (health, the
  well-known agent card, static assets) are explicitly allowed.
- Auth-shaped routes (signup/login/billing/referral) only register when
  `LAVERN_AUTH_ENABLED=true`; in LOCAL MODE they 404.
- Rate limits apply globally per IP and more strictly on signup, login, and
  forgot-password (`src/api/routes/auth-routes.ts`).

## 4. Privileged surfaces

- **Managed-agents bridge** (`src/mcp/remote-bridge/`): off unless
  `LAVERN_MANAGED_AGENTS_BRIDGE=1`; requires a Bearer secret compared in
  constant time; per-session dispatch.
- **Load-test bypass**: an `X-Load-Test-Bypass` header can skip rate limits for
  load testing. Disabled in production unless `LAVERN_ALLOW_LOAD_TEST_BYPASS=1`
  is *also* set; the server warns loudly when it is active.

## 5. Verification

- `tests/unit/firm-tenancy.test.ts` — tenant scoping properties.
- `tests/unit/deploy-guard.test.ts` — the auth/bind guard decision table.
- `tests/unit/auth-public-path-identity.test.ts` — public-path identity.
- `scripts/probe-tenant-isolation.ts` — live cross-tenant probe.
- `scripts/property-fuzz-b2b.ts` — property fuzzing of the B2B surface.

**Backlog:** wire the tenant-isolation probe and the property fuzzer into the
CI gate so cross-tenant access is regression-protected on every change, not
only when run by hand.

## 6. Provisioning and deprovisioning

Users are created via signup (self-serve) or `scripts/provision-firm-user.ts`
and `scripts/set-user-profile.ts` (operator). At pilot scale there is no
formal offboarding workflow beyond disabling/deleting a user row; this
section grows with the team. Password reset is token-based
(`src/api/routes/auth-routes.ts`) with rate limiting.

## 7. Rules

1. Firm identity for a write comes from the session, never the request body.
2. Auth is on for any non-loopback deployment. No exceptions without a logged
   decision and a compensating control.
3. New matter queries MUST go through the firm-scoped accessors; a raw
   `SELECT ... FROM matters` without `FIRM_VISIBLE` is a defect.
4. Secrets for privileged surfaces (bridge, load-test bypass) are strong random
   values, supplied via env/Fly secrets, never committed.
