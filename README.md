# DemandPay Starling

**Plaintiff-side Ontario employment law platform for law firms.**

Starling takes an employment matter from intake to court-ready draft: structured
intake (or document upload with AI fact extraction), a deterministic 16-gate
legal-issue analysis, ESA + common-law (Bardal) entitlement estimates with
limitation-deadline tracking, and lawyer-approved generation of demand letters,
Statements of Claim (Form 14A/7A), HRTO applications, ESA complaints, and
litigation documents — exported to DOCX on the firm's own letterhead template.

Live at [starling.demandpay.ca](https://starling.demandpay.ca). Operated by
Detail Dude Ltd. (o/a DemandPay), Toronto — Legal Innovation Zone.

> Starling is software for licensed legal professionals. It does not provide
> legal advice, and every document it produces is a draft that requires review
> by a lawyer before use. See the Terms of Service in-app.

## How it holds the line on quality

- **The lawyer decides.** Issues identified by the 16-gate analysis must be
  approved before they can appear in any generated document. Every draft
  carries lawyer-review flags.
- **Anonymisation on every AI call.** Party names, SINs, financial and health
  identifiers, addresses, and DOBs are redacted before content reaches the
  model and restored only server-side. Enforced by regression tests
  (`tests/unit/cross-provider-anonymisation.test.ts`).
- **Citation integrity.** A post-generation check flags any case name outside
  the known canon of Ontario employment authorities and any canon case cited
  with the wrong citation (`src/employment/citation-canon.ts`).
- **Fill-in detection.** Unknown facts surface as `[Address]`-style fill-ins
  and are flagged for completion, never invented.
- **Eval battery.** `npx tsx scripts/eval-battery.ts` runs four realistic fact
  patterns through the full pipeline against a local server with a hard API
  budget cap, scores the outputs, and writes a lawyer-review report to
  `eval-results/`.

## Architecture

- `src/employment/` — the core product: gate evaluator, timeline generator,
  demand letter / SOC / application / litigation-document generators, citation
  extraction + canon check, DOCX export with firm-template injection
- `src/api/routes/employment-intake.ts` — matter intake, analysis, issue
  decisions, generation, downloads, firm templates, notes
- `viz/src/starling/` — the dashboard: matter list, intake, matter detail
  (issues / documents / draft / timeline / notes), Deep Analysis launchers
- `src/agents/`, `src/workflows/` — the multi-agent analysis engine used by
  Deep Analysis (counsel / review / adversarial / roundtable), inherited from
  the upstream Lavern project and adapted to Ontario employment law
- `src/db/` — SQLite (matters, users, templates, archive) with daily online
  backups to `/data/backups` alongside Fly volume snapshots (30-day retention)

## Run it locally

```bash
npm install && (cd viz && npm install)
npm run serve                                        # API on :3000 (LOCAL MODE)
cd viz && VITE_BASE_PATH=/dashboard/ npm run build   # or `npm run dev` on :5173
open http://localhost:3000/dashboard/
```

Add `ANTHROPIC_API_KEY` to `.env` for document generation. Intake and the
16-gate analysis are deterministic and free.

Tests: `npm test` (backend) and `cd viz && npm test` (dashboard).

## Deploy

```bash
fly deploy    # app: demandpay-starling, region: yyz (Toronto — data stays in Canada)
```

Configuration is in `fly.toml`; secrets (`ANTHROPIC_API_KEY`, Stripe, Resend)
via `fly secrets`. Legacy multi-agent routes from the upstream project are off
by default (`LAVERN_LEGACY_ROUTES=true` re-enables them).

## Provenance & licence

Starling is a fork of [Lavern](https://github.com/AnttiHero/lavern), an
open-source multi-agent legal system by Antti Innanen ([Apache 2.0](LICENSE),
copyright 2025–2026 Antti Innanen). The multi-agent engine, debate protocol,
and verification machinery come from that work; the Ontario employment law
product layer is DemandPay's. See [NOTICE](NOTICE) for third-party attributions
and dataset licences (CUAD, MAUD, ACORD, UNFAIR-ToS, LEDGAR).
