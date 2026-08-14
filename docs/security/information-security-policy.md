# Information Security Policy

**Applies to:** DemandPay Starling and everyone who builds, operates, or has
access to it. **Owner:** the DemandPay principal (currently the sole operator).
**Last reviewed:** 2026-08-14. **Review cadence:** quarterly, and on any
material architecture or vendor change.

This is a working policy for a small, pilot-stage legal-technology product,
not a 40-page enterprise binder. It states what we protect, the principles we
hold, and the specific controls that implement them, so a reviewer or a
future teammate can see both the intent and where it lives in the code.

---

## 1. What we protect and why

Starling holds **confidential legal matter data** for plaintiff-side
employment files: client identities and contact details, employment and
compensation facts, medical and human-rights particulars, legal strategy, and
draft pleadings and correspondence. Some of this is sensitive personal
information under PIPEDA and may be subject to solicitor-client privilege.
Unauthorised disclosure could harm a client's case, their privacy, and the
firm's professional obligations. This asset drives every control we adopt.

Data is classified and handled per `data-classification-and-retention.md`.

## 2. Principles

1. **Least privilege.** A user sees only their own firm's matters. Services
   run with the narrowest access that works. Firm identity comes from the
   authenticated session, never a client-supplied parameter.
2. **Defence in depth.** No single control is trusted alone: the output
   sanitiser and CSP both guard against injected script; auth and tenant
   scoping both guard access.
3. **Secure by default.** The shipped configuration is the safe one. Auth is
   on in production and the server refuses to boot public without it.
4. **The human decides.** Starling proposes; the lawyer approves. It never
   sends, files, or takes an outward action on its own.
5. **Fail closed and fail loud.** A misconfiguration that would expose data
   stops the server rather than degrading silently.
6. **Verify, then trust.** Security-relevant behaviour is covered by tests and
   probes, not assumed.

## 3. Access control

Governed by `access-control-policy.md`. In summary: cookie-based sessions with
scrypt-hashed passwords and hashed session tokens; per-user and per-firm data
scoping enforced in every query; the managed-agents bridge gated by a
shared secret and an env flag.

## 4. Secure development

- **Test discipline.** No deploy without three consecutive clean passes of both
  the backend and frontend suites (~2,580 backend, ~106 frontend). Security-
  relevant behaviour (tenant isolation, the deploy guard, input validation) is
  covered by tests.
- **Dependencies.** `npm audit` is run and triaged; the production tree is kept
  at zero known vulnerabilities (`vulnerability-management.md`). Chromium is
  not downloaded into the runtime image.
- **Secrets.** Never committed. gitleaks scans history and the working tree
  (`.gitleaks.toml`). Secrets are supplied to production via Fly secrets/env.
- **Input validation.** Every route validates its body with a Zod schema and
  returns a message that names the offending field, never a stack trace.
- **Output encoding.** Generated HTML is allowlist-sanitised before storage
  and render; template values are XML-escaped before injection into DOCX.
- **Change control.** Work happens on the `demandpay-config` branch; changes
  are committed with descriptive messages and deployed deliberately, holding
  deploys while a pilot user is mid-action.

## 5. Operations and infrastructure

- Production runs on Fly.io (region yyz), HTTPS enforced at the edge
  (`force_https`), HSTS in production, one machine with a persistent volume for
  the SQLite database.
- Backups run daily with retention and an offsite copy
  (`src/db/backup.ts`, `src/db/offsite-backup.ts`); restore is drill-tested
  (`docs/ops/restore-drill-2026-07-14.md`).
- Security HTTP headers (CSP, HSTS, frameguard, referrer policy) are set by
  Helmet in `src/api/server.ts`.

## 6. Third parties

Data may transit or rest with the vendors enumerated in
`data-classification-and-retention.md` §4 (LLM providers, hosting, analytics,
error tracking, payments). Each is there for a stated purpose; the
EU-sovereign LLM path exists for residency-sensitive work.

## 7. Incident response

Governed by `incident-response-plan.md`. Any suspected exposure of matter data
is a priority-one incident.

## 8. Roles and responsibilities

At pilot scale the principal holds all roles: policy owner, operator,
incident responder, and approver of security changes. This section is
expected to split as the team grows; the policy owner maintains this
document and the review cadence.

## 9. Exceptions

Any deviation from this policy (for example, enabling the load-test bypass in
production, or running public without auth) requires an explicit, logged
decision by the policy owner and a documented compensating control or
end date.
