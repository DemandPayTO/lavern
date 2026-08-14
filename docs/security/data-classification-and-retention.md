# Data Classification & Retention Policy

**Owner:** DemandPay principal. **Last reviewed:** 2026-08-14.

What data Starling holds, how sensitive it is, where it lives, who it is
shared with, and how long it is kept. This is the crown-jewels inventory that
`information-security-policy.md` and `threat-model.md` reference.

---

## 1. Classification tiers

| Tier | Meaning | Examples in Starling |
|------|---------|----------------------|
| **Restricted** | Confidential legal / sensitive personal; disclosure harms a client | Client identity + contact, employment/compensation facts, medical and human-rights particulars, legal strategy, draft pleadings and correspondence, the negotiation ledger |
| **Confidential** | Firm-internal, not public | Firm templates, learned style profiles, SOC node libraries, firm file numbers |
| **Internal** | Operational, low sensitivity | Audit logs, cost/usage metering, timeline events |
| **Public** | Intended to be public | The marketing site, the well-known agent card, health endpoint |

The dominant tier is **Restricted**. Treat matter data as Restricted by
default.

## 2. Where data lives

- **Primary store:** one SQLite database on a Fly persistent volume
  (`SHEM_DB_PATH=/data/starling.db`). Matter data is JSON on the `matters`
  row; auth, firm-scoped resources, and metering are relational tables
  (`src/db/database.ts`).
- **Backups:** daily local snapshots with 30-day retention
  (`src/db/backup.ts`) plus an offsite copy (`src/db/offsite-backup.ts`).
- **In transit:** HTTPS to the API (HSTS in production); LLM calls over HTTPS
  to the provider.
- **Transient at providers:** document text and prompts are sent to the LLM
  provider for the duration of a generation. Party names are anonymised as
  defined terms before cross-provider calls where configured; the
  EU-sovereign path (Mistral) is available for residency-sensitive work.

## 3. Handling rules

1. **Restricted data never appears in URLs, query strings, or logs.** Logs
   record method/URL/status and IDs, not matter contents.
2. **Uploaded documents are sanitised** (SMAC-L1, invisible-content stripping)
   before any AI processing.
3. **Generated documents are HTML-sanitised** before storage and render.
4. **No Restricted data to a third party the user did not choose.** Sources
   suggested by observed/tool content are never used as recipients or
   endpoints.
5. **Anonymisation** is available for entity redaction with a reversible
   mapping (`src/claw/anonymize.ts`) in the Claw pipeline.

## 4. Third parties (sub-processors)

| Vendor | Purpose | Data exposed | Tier |
|--------|---------|--------------|------|
| Anthropic (Claude) | Document drafting, extraction | Prompts incl. matter facts (anonymised terms where configured) | Restricted |
| Mistral AI (EU sovereign) | Optional EU-residency drafting path | As above, EU-resident | Restricted |
| Fly.io | Hosting, compute, volume, backups target | All data at rest and in process | Restricted |
| Stripe (gated) | Billing (only when `LAVERN_AUTH_ENABLED`) | Billing metadata, not matter contents | Confidential |
| Sentry (if DSN set) | Error tracking | Error metadata; must not carry matter contents | Internal |
| Plausible | Privacy-preserving web analytics | Page-level analytics, no PII | Internal |
| DiceBear (`api.dicebear.com`) | Agent avatars | None (deterministic avatar seeds) | Public |
| Google Fonts | Dashboard typography | Request metadata only | Public |

**Rule:** adding a sub-processor that touches Restricted data requires a
logged decision by the policy owner and an update to this table.

## 5. Retention and deletion

- **Live matter data** is retained while the matter is active and per the
  firm's engagement. There is currently no automated retention-expiry job.
- **Backups** retain 30 days (`src/db/backup.ts`).
- **Audit / metering** is append-only with rotation (`src/claw/audit.ts` for
  the Claw pipeline).
- **Deletion:** a matter or user row can be deleted by the operator; a
  self-serve, provable per-client data-deletion path (including purge from
  backups on the retention schedule) is a **backlog item** and should be built
  before onboarding clients who require a documented deletion guarantee.

## 6. Data at rest

At-rest confidentiality currently relies on the Fly volume's platform-level
encryption. Application-level field encryption of Restricted columns is **not**
implemented. This is an accepted gap at pilot scale, recorded in
`threat-model.md` §5 and `vulnerability-management.md`; revisit before scaling
the client base or if a client contract requires field-level encryption.

## 7. Backlog

1. Automated retention-expiry and a provable per-client deletion path
   (including backup purge).
2. Evaluate application-level encryption for Restricted columns.
3. Confirm and document Sentry scrubbing so no matter content reaches error
   tracking.
