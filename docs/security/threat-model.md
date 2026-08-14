# Starling Threat Model

**Scope:** DemandPay Starling — the deployed plaintiff-side Ontario employment
and labour workflow platform (Fly app `demandpay-starling`,
https://starling.demandpay.ca), built on the Lavern/Shem engine.
**Method:** STRIDE over the real architecture, as verified in the codebase.
**Last reviewed:** 2026-08-14. Re-review on any change to auth, tenancy, the
document pipeline, the managed-agents bridge, or the backup path.

This document is the map a penetration tester and any future client security
review should start from. It states what the system is, where the trust
boundaries are, what could go wrong at each, and what control answers it.

---

## 1. System overview and data flows

Starling is a single Fastify HTTP + WebSocket server (`src/api/server.ts`)
serving a React SPA (`viz/`, built to `/dashboard/`) and a JSON/WebSocket API
under `/api`. State lives in one SQLite database on a Fly persistent volume
(`SHEM_DB_PATH=/data/starling.db`). Document drafting calls out to LLM
providers (Anthropic; Mistral for the EU-sovereign path) through a single
abstraction (`src/providers/cross-provider-chat.ts`).

Principal data flows:

1. **Lawyer → API → DB.** Authenticated lawyer creates matters, enters
   intake, uploads client documents. All matter data is JSON on the `matters`
   row, scoped by user and firm.
2. **Uploaded document → parser → LLM extractor → review → intake.** Client
   documents are parsed (`src/documents/`), sanitised (SMAC-L1,
   `src/documents/sanitize-text.ts`), sent to an LLM for fact extraction, and
   the proposals wait for the lawyer's approval before touching the intake.
3. **Intake → deterministic engine + LLM → generated document.** Damages,
   deadlines, and pleading structure are computed deterministically; the LLM
   writes only narrative prose; output is HTML-sanitised
   (`sanitiseHtml`) before storage and render.
4. **Managed-agents bridge (optional, env-gated).** When
   `LAVERN_MANAGED_AGENTS_BRIDGE=1`, a JSON-RPC bridge
   (`src/mcp/remote-bridge/`) exposes Counsel tools to Anthropic Managed
   Agents behind a shared-secret Bearer token.

**Crown-jewel asset:** the confidential legal matter data (client identities,
employment facts, strategy, draft pleadings). Every control below exists to
keep that data scoped to the firm that owns it and out of the wrong hands.

---

## 2. Trust boundaries

| # | Boundary | Untrusted side | Trusted side |
|---|----------|----------------|--------------|
| B1 | Public internet → API | Any HTTP client | Authenticated session |
| B2 | Authenticated user → another firm's data | Firm A's user | Firm B's matters |
| B3 | Uploaded document content → LLM prompt | Document bytes | Model instructions |
| B4 | LLM output → rendered HTML | Model text | The lawyer's browser |
| B5 | Managed-agents bridge caller → Counsel tools | Remote agent | Session dispatch |
| B6 | Build/deploy pipeline → running server | Dependencies, config | Production process |
| B7 | Backups / volume → at rest | Storage medium | Live data |

---

## 3. STRIDE analysis

### Spoofing (who are you?)

- **T-S1 — Session forgery.** *Threat:* an attacker forges a session cookie to
  act as a lawyer. *Control:* session tokens are 32 random bytes, stored only
  as SHA-256 hashes (`src/db/database.ts`), compared server-side; the cookie is
  `HttpOnly; SameSite=Lax; Secure` (prod). No token secret is client-derivable.
  *Residual:* token theft via XSS — mitigated by CSP (T-T2) and HttpOnly.
- **T-S2 — Credential stuffing / brute force.** *Threat:* automated login
  guessing. *Control:* passwords are scrypt-hashed and compared with
  `timingSafeEqual`; login, signup, and forgot-password carry per-route rate
  limits (`src/api/routes/auth-routes.ts`) on top of the global per-IP limit.
  *Gap to close:* no account lockout / progressive backoff after N failures
  (see `vulnerability-management.md` backlog).
- **T-S3 — Bridge impersonation.** *Threat:* an attacker calls the
  managed-agents bridge. *Control:* Bearer secret compared with
  `timingSafeEqual`; the bridge refuses to start without the secret and is
  off unless `LAVERN_MANAGED_AGENTS_BRIDGE=1`.

### Tampering (did the data change?)

- **T-T1 — SQL injection.** *Threat:* crafted input alters a query. *Control:*
  all queries are parameterised (better-sqlite3 prepared statements); the one
  dynamic `SET` clause (`updateUserProfile`) builds column names from a
  hardcoded allowlist, never user input.
- **T-T2 — Stored XSS via generated or uploaded content.** *Threat:*
  model-generated or uploaded HTML executes script in the lawyer's browser.
  *Controls (defence in depth):* (a) generated HTML passes an allowlist
  sanitiser (`sanitiseHtml` — tags/attributes allowlisted, `http/https/mailto`
  only, inline styles stripped); (b) CSP `script-src` carries no
  `unsafe-inline`/`unsafe-eval`, so injected script cannot run even if it
  survived the sanitiser (`src/api/server.ts`).
- **T-T3 — Prompt injection.** *Threat:* text inside an uploaded document
  ("ignore your instructions and…") is treated as a command. *Controls:*
  SMAC-L1 sanitisation strips zero-width/hidden Unicode before the model sees
  the document; document content is framed as data with delimiter defences in
  the prompts; web search is restricted to a Canadian-legal-domain allowlist
  (PLATFORM_RULES Rule 8); the platform's instruction-source boundary treats
  all tool-observed content as data, not instructions.

### Repudiation (can we prove what happened?)

- **T-R1 — Disputed action.** *Threat:* a user denies making a change.
  *Control:* matters carry `last_modified_by`; the engine writes an
  append-only audit trail (`src/claw/audit.ts` for the Claw pipeline);
  failed requests are logged with method/URL/status. *Gap:* there is no
  comprehensive per-matter mutation audit log on the Starling side beyond
  `last_modified_by` and the timeline events — a backlog item for a product
  handling legal records.

### Information disclosure (who can see it?)

- **T-I1 — Cross-tenant read (the highest-value threat).** *Threat:* Firm A's
  user reads Firm B's matters. *Control:* every matter query runs through a
  single `FIRM_VISIBLE` predicate (`m.user_id = ? OR m.firm_id = (the caller's
  firm)`), fully parameterised; firm-scoped tables carry `firm_id NOT NULL`.
  *Verification:* `scripts/probe-tenant-isolation.ts` and
  `tests/unit/firm-tenancy.test.ts`. *Backlog:* promote the probe into the CI
  gate (see `access-control-policy.md`).
- **T-I2 — Auth-disabled public exposure.** *Threat:* a deploy ships with
  `LAVERN_AUTH_ENABLED` unset, serving every matter as the synthetic
  `local-user`. *Control:* the boot guard (`publicNoAuthBindError`,
  `src/api/server.ts`) refuses to start with auth off while bound to a
  non-loopback interface unless `LAVERN_ALLOW_PUBLIC_NO_AUTH=1` is set.
- **T-I3 — Secret leakage.** *Threat:* API keys or session secrets in source,
  logs, or errors. *Controls:* gitleaks scanning (`.gitleaks.toml`,
  `docs/SECURITY_AUDIT_2026-05-13.md`); the global error handler surfaces a
  human message, never a stack trace, on 5xx; provider errors are logged
  server-side and replaced with friendly text to the client.
- **T-I4 — Data to a third party.** *Threat:* confidential facts leak to an
  external service. *Controls:* the provider layer anonymises defined terms
  (party names) before cross-provider calls where configured; the EU-sovereign
  path (Mistral) exists for data-residency-sensitive work; third parties are
  enumerated in `data-classification-and-retention.md` §4.

### Denial of service (can we keep serving?)

- **T-D1 — Request flooding.** *Control:* global per-IP rate limit
  (`@fastify/rate-limit`) plus stricter auth-route limits; the load-test bypass
  is disabled in production unless explicitly and doubly opted in.
- **T-D2 — Expensive-generation abuse.** *Threat:* an attacker triggers many
  costly LLM generations. *Control:* generation requires an authenticated,
  firm-scoped session; per-user cost is metered. *Gap:* no per-user generation
  quota / budget ceiling — a backlog item.
- **T-D3 — Algorithmic DoS in dependencies.** *Control:* the js-yaml omap and
  nanoid loop CVEs are patched; production dependency tree is clean
  (`npm audit --omit=dev` → 0). Tracked in `vulnerability-management.md`.

### Elevation of privilege (can you do more than you should?)

- **T-E1 — needs_lawyer → automated edit.** *Threat:* a review item requiring
  lawyer judgment is executed as an automated change. *Control:* the revision
  loop refuses to turn a `needs_lawyer` item into an edit; the whole apply is
  refused if any unapproved paragraph changed
  (`src/employment/revision-loop.ts`).
- **T-E2 — Firm-admin actions by a non-admin.** *Threat:* a user overwrites
  another firm's templates or nodes. *Control:* firm-scoped writes derive
  `firm_id` from the authenticated identity only, never a body parameter (the
  legacy `/:firmId` routes were removed for exactly this reason).
- **T-E3 — Human gate bypass.** *Threat:* an AI action that must be
  lawyer-approved proceeds without approval. *Control:* human gates are
  mandatory in the engine (`src/gates/`, `src/hooks/`); "the lawyer decides"
  is a product non-negotiable — Starling never sends or files.

---

## 4. Attack surface summary (for the pen tester)

- **Public HTTP/WS API** under `/api` — the primary surface. Auth on every
  protected route; CORS allowlisted; CSRF posture: cookie `SameSite=Lax` plus
  Origin checks on WebSocket upgrades.
- **File upload** (`/api/documents/parse`, extraction routes) — parser
  hardening, SMAC-L1, 10 MB cap, magic-byte sniffing on precedents.
- **Managed-agents bridge** — env-gated, shared-secret; out of scope unless
  the engagement enables it.
- **Static dashboard** under `/dashboard/` — CSP-governed.
- **Auth flows** — signup/login/forgot-password, rate-limited.

**Out of scope for a standard engagement unless requested:** the marketing
site (`site/`, static Netlify), the Claw autonomous pipeline (separate CLI,
not the deployed web surface), the menubar app.

---

## 5. Known gaps carried as backlog

These are stated plainly so they are not "findings" that surprise anyone:

1. No account lockout / progressive backoff after repeated failed logins.
2. No comprehensive per-matter mutation audit log (only `last_modified_by`
   plus timeline events).
3. No per-user generation budget ceiling (cost is metered, not capped).
4. The tenant-isolation probe and property fuzzer are scripts, not yet CI
   gates.
5. CSP `style-src` retains `'unsafe-inline'` for the React app's inline
   styles — accepted as a low-risk compromise; script-src is locked.
6. Data-at-rest encryption relies on the Fly volume's platform encryption;
   application-level field encryption is not implemented (see
   `data-classification-and-retention.md`).

Each has an owner and a target in `vulnerability-management.md`.
