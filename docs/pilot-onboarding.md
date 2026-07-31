# DemandPay Starling — Pilot Firm Onboarding Guide

This guide has two parts. **Part A** is for the administrator (Jordan) and covers
account provisioning, precedent loading, and platform configuration. **Part B**
is written for the firm's lawyers and can be handed over as a standalone
document once accounts exist.

Product address: **https://starling.demandpay.ca**

---

## Part A — Administrator setup

### A1. The visibility model (read this before loading anything)

Starling separates what is personal from what is shared:

| Item | Scope | Who sees it |
|---|---|---|
| Matters (files, drafts, notes, timelines) | Per lawyer | Only the lawyer who created the matter |
| Firm document templates | Firm-wide | Every account sharing the firm id |
| Collective agreement library (labour) | Firm-wide | Every account sharing the firm id |
| Task calendar feed | Per lawyer | Only the holder of that lawyer's private link |
| Client intake links | Per matter | The public link shows the firm name and the client's first name only |

The firm id is minted the **first** time you provision a user for the firm.
Every template you upload while logged in is stored against your account's
firm id. Therefore the order of operations matters:

1. Provision **your own** account first, using the firm's name. The script
   prints the new firm id.
2. Log in as that account and upload all templates and precedents.
3. Provision the firm's lawyers afterwards, passing the **same** `--firm-id`,
   so they inherit the template library on day one.

There is currently **no firm-wide matter oversight view**: each lawyer sees
only their own matters. Set that expectation with the firm principal, or ask
for the oversight view to be prioritized before real files open.

### A2. Provisioning accounts

Self-signup should be disabled before onboarding (`LAVERN_SIGNUP_DISABLED=true`
on the Fly app). Accounts are created manually over SSH; email verification is
pre-set so lawyers can log in before firm email is even configured.

First account (mints the firm id, prints a temporary password):

```bash
fly ssh console -a demandpay-starling -C "sh -c 'cd /app && SHEM_DB_PATH=/data/starling.db npx tsx scripts/provision-firm-user.ts --email you@example.ca --name \"Your Name\" --firm \"Firm Name LLP\"'"
```

Each additional lawyer (reuse the printed firm id):

```bash
fly ssh console -a demandpay-starling -C "sh -c 'cd /app && SHEM_DB_PATH=/data/starling.db npx tsx scripts/provision-firm-user.ts --email lawyer@example.ca --name \"Lawyer Name\" --firm \"Firm Name LLP\" --firm-id firm-XXXXXXXXXXXX'"
```

Deliver each temporary password to its lawyer through a channel you trust
(never email the password and the address together). Each lawyer changes the
password on first login under **My Page**.

### A3. Loading the firm's precedents

Starling's template system does not store precedents as-is. Each precedent
must be converted into a **DOCX template with placeholder markers** before
upload. The template preserves the firm's letterhead, fonts, logos, headers,
footers, numbering, and styles; Starling injects matter-specific content into
the markers at generation time.

Conversion workflow per document type:

1. Take the firm's best precedent for the type (demand letter, statement of
   claim, and so on).
2. Replace the client-specific passages with the placeholders listed in
   Part B, section B6 (for example `{{CLIENT_NAME}}`, `{{FACTS_SECTION}}`,
   `{{LEGAL_ANALYSIS}}`).
3. Keep everything the firm reuses verbatim (letterhead, boilerplate,
   signature layout) exactly as it appears in the precedent.
4. Upload on the Draft tab (see B6). One template per document type; the
   newest upload replaces the old one for the whole firm.

Unlabelled redactions (black boxes) make a precedent unreliable for
conversion. Ask the firm for two or three examples per type, or one
unredacted example, and note that redacted content never needs to leave the
firm: conversion can be done on their machine or under this account with the
documents deleted afterwards.

### A4. Platform configuration checklist

- **Signup lockdown**: set `LAVERN_SIGNUP_DISABLED=true` on the Fly app
  before the firm's data goes in.
- **Email**: Starling's `RESEND_API_KEY` must come from the Resend account
  where `demandpay.ca` is verified, or password-reset email returns an error.
  Until fixed, handle forgotten passwords by re-provisioning.
- **Practice mode**: production currently runs employment-only
  (`STARLING_PRACTICE_MODE` unset defaults to `employment`; the labour
  vertical is hidden). Set it to `both` when the firm takes union-side work.
- **Weekly firm digest**: deliberately disabled for the pilot
  (`STARLING_DIGEST_ENABLED` off). The per-lawyer task digest in the Tasks
  tab is separate and opt-in per lawyer.
- **Backups**: three layers run without intervention (Fly volume snapshots,
  30 days; nightly on-volume SQLite backups, 14 days). A restore drill passed
  on 2026-07-14; repeat quarterly and after the first real client matter.
- **Test data**: remove any remaining test accounts and matters from
  production before the firm's first login.

---

## Part B — Lawyer's guide to Starling

Welcome to DemandPay Starling, a drafting and case-management platform for
plaintiff-side Ontario employment law. Starling prepares work for your
review; it never sends, files, or serves anything. You remain the author and
the professional of record for every document.

### B1. Signing in

1. Go to **https://starling.demandpay.ca** and log in with the email address
   and temporary password you received.
2. Open **My Page** and change your password immediately.
3. My Page also holds your firm profile (address, phone, email). Complete it
   once: these details flow into every generated document and remove
   placeholder gaps such as `[Address]`.

### B2. What you see, and what your colleagues see

Your matters are private to you. Colleagues at the firm cannot open your
files, and you cannot open theirs. What the firm shares is the template
library: when any lawyer uploads or replaces a firm template, every lawyer's
future documents use it. Your task calendar link is personal; treat it like a
password.

### B3. The dashboard

The dashboard is a daily glance:

- **Needs you now** lists critical items: court or statutory deadlines within
  five days (marked COURT, in red) and anything overdue (amber).
- **Today** shows tasks and deadlines due today.
- **The docket** aggregates every deadline across your matters: limitation
  periods, demand-response ticklers, litigation event chains (for example,
  Statement of Defence due 20 days after your Statement of Claim is marked
  sent), and scheduled client correspondence.
- **Recent matters** jumps back into your active files.

The **Tasks** tab is the full task list behind the glance view, and the
**Files** view shows all matters as folder cards sortable by recency, name,
priority, or status.

### B4. Your deadlines in Outlook

Starling publishes your tasks and deadlines as a personal calendar feed.

1. In the Tasks tab, copy your private calendar link.
2. Go to **outlook.office.com** (Outlook on the web; the Mac desktop app
   cannot subscribe to calendar links).
3. Choose **Add calendar → Subscribe from web**, paste the link, and name it.

Do not use **Import ICS**: an import is a frozen snapshot that never updates.
A subscription refreshes as your matters change. The feed identifies matters
by file number only, so no client names leave the platform.

### B5. A matter from start to finish

**Create.** New Matter, fill the intake form: parties, dates (hire and
termination dates drive limitation tracking), compensation, and the
circumstances. You can leave gaps; Starling works with what it has and tells
you what is missing.

**Let the client fill the intake.** On the matter's Intake tab you can
generate a **client intake link**: a private link, valid 14 days, that opens
a plain-language form for your client. The public page reveals only your firm
name and the client's first name. When the client submits, you review the
pending answers and apply them; client answers fill blank fields only and
never overwrite anything you typed.

**Run Analysis.** Starling evaluates the matter against Ontario employment
law and raises **gates** on the Issues tab: potential issues (termination
clause enforceability, ESA minimums, human rights overlap, limitation
concerns) each citing the specific text or fact it relies on. Approve the
gates you agree with; dismiss the rest. Approved issues feed the drafting
engine. The Issues tab also shows **Comparables**: outcome ranges from
verified reported decisions with similar tenure and circumstances.

**Follow Next Steps.** Above the tabs, the Next Steps panel recommends up to
three actions ranked by consequence (for example, a limitation period
approaching, a client email overdue, an unanswered offer). Each action jumps
to the right tab.

**Draft.** The Draft tab offers the full plaintiff lifecycle: retainer
compliance checklist, severance offer assessment, counter-offer, demand
letter, Statement of Claim, Notice of Application, HRTO Application (with the
Form 1 data file), ESA materials, reply, Rule 49 offer, mediation brief,
settlement conference brief, minutes of settlement and release, mitigation
log, court forms (affidavit of service, discontinuance, costs outline), and
more. Documents generate into your firm's template when one exists. Every
draft arrives with:

- **Citations** listed under the preview, checked against a verified canon;
  unknown or mismatched citations are flagged rather than trusted.
- **Lawyer review flags**: passages that need your judgment are marked
  `[LAWYER: ...]` and listed for you.
- **Version history**: prior drafts of each type are kept on the matter.

Review and edit every document. When you are satisfied, mark it **reviewed**,
**sent**, or **filed**: these states drive the downstream clocks (a demand
letter's response tickler runs from the date you mark it sent). Download as
DOCX for finishing touches in Word.

**Upload documents.** Drop the client's documents (termination letter,
employment contract, pay records) on the Docs tab. Starling detects the
document type, asks you to confirm, and proposes extracted facts with the
exact quote each fact came from. You apply extractions field by field;
proposals fill blanks by default and touch your own entries only if you
explicitly choose overwrite. For a large intake, the **case file drop**
accepts up to 30 documents at once and produces a source-cited chronology,
flags conflicts between documents for you to resolve, and writes a synthesis
memo to the matter.

**Correspond with the client.** The Client tab schedules the standard
mitigation sequence: an immediate duty-to-mitigate advice email and a
follow-up with a mitigation log at the right interval after termination.
Starling drafts; you edit, copy into your own email, send from your own
address, and mark it sent so the timeline and docket stay accurate.

**Negotiate.** The Negotiation tab records offers and counter-offers, shows
each offer against the ESA floor and the assessed range, tracks employer
movement, and nudges you when an offer has sat unanswered for five days.

**Go deeper.** The Deep Analysis actions on the matter (Second Opinion, Moot
the Employer's Response, Full Case Assessment, Settlement Valuation) convene
a larger analysis on demand and log the launch to the matter timeline.

**Close.** When the matter resolves, record the outcome. Starling snapshots
the result against its earlier predicted range, which is how the system's
accuracy stays measured.

Along the way, the **Timeline** tab is the matter's history (you can add
court dates, which docket in red), **Notes** holds your running notes, and
**Debrief** turns pasted meeting or call notes (including Zoom transcripts)
into action items that flow into your docket.

### B6. Firm templates

Templates make Starling draft on your paper. A template is your own DOCX,
with your letterhead, fonts, and boilerplate kept exactly as they are, plus
markers where matter content belongs.

To upload: open any matter's **Draft tab**, select a document type, and use
the **Firm template** panel to upload the DOCX. The template becomes the
firm-wide default for that document type on all matters, for all lawyers. One
template per type; uploading again replaces it.

Markers use double braces. The most used:

| Marker | Becomes |
|---|---|
| `{{CLIENT_NAME}}`, `{{CLIENT_ADDRESS}}` | Client identity |
| `{{EMPLOYER_NAME}}`, `{{EMPLOYER_ADDRESS}}` | Employer identity |
| `{{FIRM_NAME}}`, `{{LAWYER_NAME}}`, `{{FIRM_ADDRESS}}` | Your firm block |
| `{{DATE}}`, `{{FILE_NUMBER}}` | Document date, matter number |
| `{{SALUTATION}}`, `{{CLOSING}}`, `{{SIGNATURE_BLOCK}}` | Letter framing |
| `{{EMPLOYMENT_BACKGROUND}}`, `{{TERMINATION_FACTS}}` | Narrative sections |
| `{{LEGAL_ANALYSIS}}`, `{{DAMAGES_SECTION}}`, `{{DEMAND}}` | Analysis and ask |
| `{{TITLE_OF_PROCEEDINGS}}`, `{{CLAIM}}`, `{{FACTS_SECTION}}`, `{{LEGAL_BASIS}}`, `{{DAMAGES_PARTICULARS}}`, `{{RELIEF_SOUGHT}}` | Statement of Claim structure |

Conditional blocks (`{{#SECTION}}...{{/SECTION}}`) include their contents
only when the section has content. Any marker Starling cannot fill is left
visible in the output so nothing disappears silently.

### B7. The rules Starling lives by

- **Starling never sends or files.** Every email, letter, and pleading leaves
  through you.
- **Every finding cites its evidence.** Gates quote the text they rely on;
  extractions show their source quotes; citations are verified against a
  canon of real decisions and flagged when they cannot be.
- **Your entries are never overwritten.** Client intake answers and document
  extractions fill blanks; changing your own entries always requires your
  explicit choice.
- **Deadlines err protective.** Limitation and docket dates are computed
  conservatively; a red COURT item means a court or statutory deadline within
  five days.
- **AI assistance is disclosed.** Document analysis and drafting use large
  language models under the platform's privacy terms (in-app under Terms and
  Privacy). Starling assists with drafting and organization; it does not
  provide legal advice, and professional judgment on every output remains
  yours.

### B8. If something goes wrong

- **Forgot password**: contact your administrator (password-reset email may
  not be active during early pilot).
- **A draft looks wrong**: check the Issues tab first; drafts are built from
  approved gates and intake facts, so correcting the inputs and regenerating
  is usually the fix. Prior versions remain in the draft history.
- **A deadline looks wrong**: deadlines derive from intake dates and document
  states (sent and filed dates). Verify those on the Intake and Draft tabs.
- **Anything else**: your administrator can reach the development team
  directly; nothing in the pilot is more than a message away from a fix.
