# Starling Form and Document Catalogue

**Prepared 2026-07-04 for Jordan's review.** The complete map of forms and documents
for the employment (plaintiff-side) and labour (union-side) verticals, by forum,
with what Starling already covers, what to build next, and how each item should
be implemented.

**Verify before building.** Form numbers and versions change. Every number below
must be confirmed against the official source at build time: ontariocourtforms.on.ca
(Superior Court and Small Claims), tribunalsontario.ca (HRTO), olrb.gov.on.ca (OLRB),
and ontario.ca/labour (MOL/ESA). Numbers marked *(confirm)* are ones I have not
verified against the current official source. `scripts/fetch-official-forms.sh`
is the existing pattern for pinning official form versions.

**Implementation paths** (in order of preference for each item):

1. **Generated document (HTML → DOCX).** The existing pipeline. Right for anything
   that is substantively drafted: pleadings content, letters, briefs, memoranda.
2. **Data-file population (XFA datasets import).** For locked dynamic SmartForms
   that cannot be filled programmatically (the HRTO pattern shipped for Form 1).
3. **Direct PDF fill (AcroForm).** Most court forms are ordinary fillable PDFs or
   Word documents, unlike the HRTO's encrypted XFA forms. pdf-lib can likely fill
   these directly; test each form once before assuming.
4. **Deterministic build.** No model call. Right for worksheets, logs, and service
   documents that are pure data (the remedy worksheet and mitigation log pattern).

Priorities: **P1** = needed for a credible pilot; **P2** = needed as matters mature
into litigation or arbitration; **P3** = build on demand.

---

## 1. Superior Court of Justice (Rules of Civil Procedure)

The main venue for wrongful dismissal above the Small Claims limit. Most wrongful
dismissal actions now resolve by summary judgment under Rule 20, which makes the
motion package the highest-value gap in this table.

| Form / document | What it is | Status | Priority | Path |
|---|---|---|---|---|
| Form 14A, Statement of Claim | The pleading | **Shipped** (generated content in 14A format) | done | 1 |
| Form 14E, Notice of Application | Application route | **Shipped** (generated content) | done | 1 |
| Form 14C, Notice of Action | Limitation-saving start when time is short | **Shipped** 2026-07-04 (generated; the official form's printed warnings are a placeholder by design) | done | 1 |
| Form 25A, Reply | Answer to new matters in the Defence | **Shipped** | done | 1 |
| Form 49A, Offer to Settle | Rule 49 offer with cost consequences | **Shipped** | done | 1 |
| Form 49B (withdrawal), Form 49C (acceptance) | The rest of the Rule 49 lifecycle | **Shipped** 2026-07-04 (deterministic, validated inputs). 49D (offer to contribute) and 49E (partial settlement) remain on demand | done / P3 | 4 |
| Form 30A / 30B, Affidavit of Documents (individual / corporation) | Rule 30 disclosure | Content generator **shipped** (affidavit_of_documents); not yet mapped onto the court form | P2 | 1 or 3 |
| Form 37A, Notice of Motion + Form 4D, Affidavit | The Rule 20 **summary judgment package**, with a factum | **Shipped** 2026-07-04: notice of motion, plaintiff's affidavit from intake facts (sworn-evidence discipline), and factum with the settled authorities (Hryniak, Bardal, Waksdale, Machtinger, McKinley, Honda) | done | 1 |
| Factum (summary judgment / motions) | Argument with authorities | **Shipped** 2026-07-04 (see above); Hryniak added to the citation canon | done | 1 |
| Form 16B, Affidavit of Service | Proof of service | **Shipped** 2026-07-04 (deterministic from service details entered in the UI) | done | 4 |
| Form 53, Acknowledgment of Expert's Duty | Attaches to any expert report | Missing; trivial fill | P3 | 3 |
| Form 57B, Costs Outline | Costs submissions after motions/trial | **Shipped** 2026-07-04 (deterministic; rates, hours, and disbursements entered in the UI, arithmetic shown) | done | 4 |
| Pre-trial conference report *(confirm number)* | Rule 50 | **Shipped** as the settlement conference brief (forum-adaptive); confirm whether the court's fillable report form should also be populated | P2 | 1 |
| Trial record, requisitions, notices of examination | Later-stage litigation mechanics | Missing | P3 | 3/4 |

## 2. Small Claims Court (O. Reg. 258/98)

High-volume forum for modest wrongful dismissal claims (limit $50,000 since
October 1, 2025). Note that the Small Claims Court has its own form numbering
that collides with the civil rules (its Form 14A is an offer to settle, not a
claim).

| Form / document | What it is | Status | Priority | Path |
|---|---|---|---|---|
| Form 7A, Plaintiff's Claim | The claim | **Shipped** (generated content in 7A format); consider also filling the fillable court form for e-filing | P1 (form fill) | 1 → 3 |
| Form 8A, Affidavit of Service *(confirm)* | Proof of service | Missing; deterministic | P1 | 4 |
| Form 9A, Defence | Employer side; deliberately out of scope | skip | – | – |
| Form 13A, List of Proposed Witnesses | Required before the settlement conference | Missing; deterministic from a witness input; pairs with the shipped Rule 13 brief | P2 | 4 |
| Form 14A (SCC), Offer to Settle | Small Claims offer | Missing; adapt the Rule 49 generator (different cost consequences) | P2 | 1 |
| Form 15A, Notice of Motion and Supporting Affidavit | Motions | Missing | P3 | 3 |
| Form 18A, Summons to Witness | Trial | Missing; deterministic | P3 | 4 |
| Form 20-series, enforcement (garnishment, seizure, examination) *(confirm numbers)* | Collecting on judgment; a real plaintiff-side need employers of tools ignore | Missing | P3 | 3/4 |
| Default judgment request *(confirm number)* | When the employer does not defend | Missing | P3 | 4 |

## 3. HRTO (Tribunals Ontario SmartForms)

All locked dynamic XFA forms: the data-file import pattern shipped for Form 1 is
the path for every one of these.

| Form / document | What it is | Status | Priority | Path |
|---|---|---|---|---|
| Form 1, Application | Individual application | **Shipped** (XFA data file + generated Schedule "A") | done | 2 |
| Schedule "A" narrative | The allegations narrative filed with Form 1 | **Shipped** | done | 1 |
| Form 2, Response *(applicant side rarely files, but reps for respondent-intervenors do)* | Response to an application | Queued (next form per the plan); confirm scope given the plaintiff-side posture | P1 (if wanted) | 2 |
| Form 7, Application on Behalf of Another Person | Litigation guardians, estates | Missing | P3 | 2 |
| Form 10, Request for an Order During Proceedings | Interim orders, production disputes, adjournments; the workhorse motion form | Missing; high value once HRTO matters mature | P2 | 2 + 1 (narrative) |
| Form 23, Contravention of Settlement *(confirm)* | Enforcing HRTO settlements | Missing | P3 | 2 |
| Withdrawal form *(confirm number)* | Ending an application (often on settlement) | Missing; deterministic | P2 | 2 |
| Mediation materials | HRTO mediation brief | Partially covered by the mediation brief generator; add an HRTO-specific variant (Code damages framing, s. 45.2 remedies) | P2 | 1 |

## 4. Ministry of Labour / ESA

| Form / document | What it is | Status | Priority | Path |
|---|---|---|---|---|
| ESA Claim | The employment standards claim (online filing; narrative and particulars matter more than the form) | Content generator **shipped** (esa_complaint); the two-year filing deadline with the ss. 97/98 election caution now dockets automatically (2026-07-04). Field mapping to the online claim form remains | P2 (mapping) | 1 → 2/3 |
| Application for Review of an ESA order/refusal | Goes to the **OLRB** (see below); strict 30-day limit worth a docket clock | Missing | P2 | 1 + clock |
| OHSA s. 50 reprisal complaint (OLRB) | Alternative forum to grievance arbitration; LG10 already flags the election | Missing (see OLRB) | P2 | 2/3 |

## 5. OLRB (labour vertical)

OLRB filings use numbered A-series forms; **every number must be confirmed
against the current olrb.gov.on.ca forms list before building** (the Board
renumbers periodically; the shipped DFR response prompt references the A-114
responding form, which should be re-verified at the same time).

| Form / document | What it is | Status | Priority | Path |
|---|---|---|---|---|
| DFR application response (s. 74) | The union's responding position | Narrative **shipped**; form numbers verified 2026-07-04 against olrb.gov.on.ca: application is Form A-29, response is **Form A-30** (the prompt now cites A-30). PDF fill of A-30 remains | P2 (form fill) | 1 → 3 |
| ULP complaint / response (ss. 70, 72, 76, 86 freeze) | Interference, intimidation, freeze breaches | Missing; a bargaining-season staple | P2 | 1 + 3 |
| OHSA s. 50 reprisal complaint | Reverse-onus reprisal forum | Narrative **shipped** 2026-07-04 (Form A-53 verified; response is A-54); built to trigger the s. 50(5) reverse onus, with the forum-election flag | done (narrative) | 1 + 3 |
| Certification application / response | Organizing drives | Missing; decide whether organizing support is in scope at all | P3 | 3 |
| Termination of bargaining rights (response) | Defending decertification | Missing | P3 | 3 |
| ESA Application for Review | See MOL section; filed at the Board | Missing | P2 | 1 + 3 |

## 6. Grievance arbitration and bargaining (labour, non-Board)

Mostly documents, not government forms.

| Document | Status | Priority | Path |
|---|---|---|---|
| Grievance, referral, arbitration brief, DFR response, merits assessment, decline letter, grievor update, remedy worksheet | **Shipped** (8 types) | done | 1/4 |
| Particulars of grievance | **Shipped** 2026-07-04 | done | 1 |
| Production / disclosure request letter | **Shipped** 2026-07-04 (categories tailored to the approved issues) | done | 1 |
| Memorandum of Settlement (grievance) | **Shipped** 2026-07-04 (discipline-record disposition and Code contracting-out cautions built in) | done | 1 |
| Last chance agreement (review and draft) | Missing; flag accommodation carve-out traps | P2 | 1 |
| Grievance withdrawal letter | Missing; deterministic | P2 | 4 |
| Will-say statements / witness outlines | Missing | P2 | 1 |
| Agreed statement of facts | Missing | P2 | 1 |
| Opening statement / written closing argument | Missing (distinct from the pre-hearing brief) | P2 | 1 |
| MOL s. 49 application for appointment of arbitrator (expedited) *(confirm current form)* | Missing; pairs with the referral generator | P2 | 3 |
| Notice to bargain (LRA s. 16 / s. 59) | Missing; bargaining vertical | P3 | 1 |
| Request for conciliation / no-board sequence | Missing; the no-board clock (conciliation → report → 17 days) is another deterministic deadline engine | P3 | 1 + clock |
| Interest arbitration brief (HLDAA, police/fire) | Missing; large, public-sector firm demand | P3 | 1 |

## 7. Adjacent and federal (decide scope before building)

| Item | Notes | Priority |
|---|---|---|
| CLC s. 240 unjust dismissal complaint (federal employees) | Different regime entirely (banks, telecom, interprovincial transport); reinstatement available. Decide whether federal jurisdiction is in scope; if yes, this plus CIRB DFR forms | P3 |
| WSIB Form 6, objections, WSIAT Notice of Appeal | Return-to-work and reprisal overlap with both verticals | P3 |
| Pay Equity Act maintenance complaints | Union-side | P3 |
| EI reconsideration / SST appeal | Clients routinely need this after termination; low-cost goodwill feature | P3 |

## 8. Unidentified downloads

Jordan's Downloads folder holds forms referenced as "SJT0xx, Forms 29-32, TO001E",
which the shell cannot read (macOS privacy controls). Identify these by name and
map them into the tables above; they likely overlap with the Superior Court and
Tribunals Ontario items already listed.

---

## Recommended build order

1. **P1 employment:** Form 14C Notice of Action (limitation-critical), Form 16B /
   SCC affidavit of service (deterministic), Small Claims Form 7A form-fill,
   ESA claim form mapping, HRTO Form 2 if respondent-side intake is wanted.
2. **P1 labour:** particulars of grievance, production request letter, Memorandum
   of Settlement, OLRB DFR response form mapping.
3. **P2 flagship:** the Rule 20 summary judgment package (notice of motion,
   affidavit from intake facts, factum). It is the largest single gap between
   Starling and how wrongful dismissal practice actually concludes.
4. Everything else on demand, confirming form numbers against official sources
   at build time.
