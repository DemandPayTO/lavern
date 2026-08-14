# Starling Security Documentation

The security governance for DemandPay Starling. Written for a small,
pilot-stage legal-technology product: real, accurate, and grounded in the
actual codebase, not enterprise boilerplate. Start with the threat model — it
is the map.

## Documents

| Document | What it covers |
|----------|----------------|
| [threat-model.md](./threat-model.md) | STRIDE over the real architecture; trust boundaries; attack surface; known gaps. **Start here.** |
| [information-security-policy.md](./information-security-policy.md) | Principles, what we protect, secure development, operations. |
| [access-control-policy.md](./access-control-policy.md) | Identity, authentication, the firm-tenant authorization model, privileged surfaces. |
| [data-classification-and-retention.md](./data-classification-and-retention.md) | Classification tiers, where data lives, sub-processors, retention and deletion. |
| [vulnerability-management.md](./vulnerability-management.md) | Dependency and code vulnerability handling, severity/SLA, the security backlog. |
| [incident-response-plan.md](./incident-response-plan.md) | How to respond to a security incident, priority-one being matter-data exposure. |

Related, pre-existing:
- [../SECURITY_AUDIT_2026-05-13.md](../SECURITY_AUDIT_2026-05-13.md) — the OSS-launch secret-scan and license audit (not an application pen test).
- [../PLATFORM_RULES.md](../PLATFORM_RULES.md) — the platform's hard rules, including the web-search allowlist (Rule 8).

## Pre-penetration-test checklist

Before booking an engagement:

- [x] Threat model written (this directory).
- [x] Policy set written (this directory).
- [x] CSP enforced; production dependency tree clean; deploy guard in place.
- [ ] Tenant-isolation probe + property fuzzer promoted into the CI gate.
- [ ] Data-at-rest posture documented and reviewed (done in
      `data-classification-and-retention.md`; encryption decision pending).
- [ ] Pentest scoping artifacts: asset inventory, rules of engagement,
      in/out-of-scope boundary, test accounts + seed data, remediation SLA.

## Consolidated security backlog

Owned in `vulnerability-management.md` §5; summarised:

1. Account lockout / progressive backoff on failed logins.
2. Comprehensive per-matter mutation audit log.
3. Per-user generation budget ceiling.
4. Tenant-isolation probe + property fuzzer into CI.
5. Automated retention-expiry + provable per-client deletion (incl. backup purge).
6. Application-level encryption for Restricted columns (revisit at scale).
7. Confirm Sentry scrubbing excludes matter content.

## Review cadence

Quarterly, and on any material change to auth, tenancy, the document pipeline,
the managed-agents bridge, the backup path, or the vendor list.
