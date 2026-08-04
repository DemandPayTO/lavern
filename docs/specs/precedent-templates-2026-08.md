# Precedent Templates — Spec (drafted 2026-08-03, awaiting Jordan's decisions)

Jordan's ask, in his words: stop making the lawyer convert every precedent
into a placeholder template by hand; let a firm keep several templates per
document type (a demand letter for constructive dismissal, another for
termination during medical leave); and let the lawyer pick one and have the
matter's information populate it.

This spec is written to be decided on, not just built. Section 1 is the
decision that governs everything else.

---

## 1. The decision that comes first: what a template IS

Two products are hiding under the word "template", and Starling currently
ships the first while Jordan is describing the second.

**Model A — letterhead wrapper (what exists today).** The firm's DOCX
supplies letterhead, fonts, and footer. Starling generates the entire body
and drops it into the template. Verified in the code: `buildPlaceholderValues`
([firm-templates.ts:202](../../src/employment/firm-templates.ts:202)) assigns
the *same* `generatedHtml` to `LEGAL_ANALYSIS` and `FACTS_SECTION` alike, so
every content marker receives the whole document. The published catalogue of
twenty-plus markers is aspirational: only the identity markers (client,
employer, firm, date, file number) are genuinely distinct. A firm that put
two content markers in one template would get the document twice.

**Model B — the precedent is the document.** The firm's precedent supplies
the actual language. Starling swaps variables (names, dates, amounts,
employer) and leaves the firm's drafting intact. This is what "convert my
precedent into a template" means in a lawyer's mouth, and it is what makes
"one for constructive dismissal, one for medical leave" coherent: those are
two different documents, not two letterheads.

**Model C — hybrid (recommended).** The precedent supplies structure and all
boilerplate verbatim. Starling generates ONLY the passages that must be
bespoke to the matter (the facts narrative, the entitlements analysis, the
quantum), inserted at points the lawyer confirmed during conversion.

**Recommendation: Model C.** Model A wastes the firm's best asset (their
tested language). Model B cannot handle the parts that genuinely differ case
to case, which is most of the value Starling adds. Model C keeps the firm's
words where the firm has words worth keeping and generates only where
generation is warranted. It also degrades gracefully: a precedent converted
with zero generated sections behaves exactly like Model B.

**Jordan decides:** Model C as recommended, or Model B (simpler, no generated
sections at all, faster to ship).

---

## 2. Auto-conversion: precedent DOCX to template

Yes, this is feasible. The pipeline, with the safety property that makes it
usable on a law firm's precedents:

1. **Upload.** Lawyer uploads a precedent DOCX on the new Templates screen,
   choosing the document type and naming the variant.
2. **Parse.** Extract the document text with structure preserved (mammoth is
   already a dependency and already used for the review-lane DOCX path).
3. **Propose.** One model call returns a proposal: for each span it believes
   is case-specific, the exact verbatim text, the placeholder it maps to, and
   a confidence. For Model C it additionally proposes which sections are
   "generate per matter" (facts narrative, analysis) versus "keep verbatim".
4. **Verify deterministically (the safety property).** Reassemble the
   document from the proposal: every character outside the proposed spans
   must be byte-identical to the original. Any drift, any invented or
   reworded text, and the proposal is rejected before the lawyer ever sees
   it. The model can only ever *select* spans; it can never rewrite the
   firm's language. This mirrors the quote-grounding discipline already used
   in the extraction apply loop.
5. **Review.** Side-by-side screen: original on the left, proposed
   placeholders highlighted on the right. Per span: accept, reject, or change
   which placeholder it maps to. Nothing is saved until the lawyer confirms.
6. **Save.** Store the template with its placeholder map and variant label.

**Cost:** one model call per precedent, roughly $0.05 to $0.30 depending on
length. Paid once per precedent, never again.

**Known limit (do not paper over this).** Redacted precedents with black-box
redactions produce unlabelled gaps and unreliable inference — the finding
from 2026-07-20 stands. Auto-conversion wants unredacted source. It never
leaves Starling's own infrastructure, and the review step means a bad
proposal costs the lawyer a rejection, not a bad document.

---

## 3. Variants: several templates per document type

**Schema.** `firm_templates` today is `UNIQUE(firm_id, document_type)` — one
per type, which is exactly the constraint Jordan hit. Change to:

- add `variant_id TEXT`, `variant_label TEXT`, `is_default INTEGER DEFAULT 0`
- unique key becomes `(firm_id, document_type, variant_id)`
- migration: existing rows get a generated `variant_id`, the label "Standard",
  and `is_default = 1`, so nothing breaks and current behaviour is preserved

**Accessors.** `getFirmTemplate(firmId, documentType)` gains an optional
variant argument and falls back to the default; `getFirmTemplates` returns
variants grouped by type. `injectIntoFirmTemplate` and `htmlToDocx` take the
variant through
([docx-export.ts:237](../../src/employment/docx-export.ts:237)).

**Naming.** Variant labels are free text chosen by the firm ("Constructive
dismissal", "Medical leave", "Just cause alleged"). No fixed taxonomy:
firms organise precedents their own way and a schema that fights that gets
abandoned.

---

## 4. The lawyer's experience

**Choosing.** On the Draft tab, selecting a document type reveals its
variants as a short radio list with the firm's own labels, default
preselected. One click, then Generate. When a type has one variant, the
picker stays hidden — no new friction for the common case.

**Suggesting (optional, worth it).** Starling already knows the matter's
approved issues, so it can mark the variant that matches ("constructive
dismissal is an approved issue on this matter") as a suggestion. A
suggestion, never an automatic switch: the lawyer picks.

**Managing.** A Templates screen under the firm settings: variants grouped by
document type, upload a precedent, rename, set default, delete, and re-run
conversion. Today template management is buried on the Draft tab of whatever
matter happens to be open, which does not match how a firm actually curates
precedents.

---

## 5. Security and tenancy

Templates are firm-scoped, and the 2026-08-03 review makes the rules
explicit: firm identity comes from the server-assigned `firm_id` only, no
body-supplied firm id, and routes deny when an account has no firm. Uploads
are DOCX only with a size cap, parsed in-process. Converted template text is
firm data and never crosses tenants. The conversion model call carries the
precedent text, so it follows the existing anonymisation path; note in the UI
that conversion sends the precedent to the model, since some firms will care.

---

## 6. Testing

- Verbatim-preservation property test: for a corpus of synthetic precedents,
  reassembly from the proposal is byte-identical outside proposed spans.
- Rejection test: a proposal that alters text outside its spans is refused.
- Variant tests: correct variant selected, default fallback, migration of an
  existing single template, cross-firm isolation.
- Round trip: upload precedent, convert, accept, generate on a matter,
  download DOCX, confirm firm formatting and letterhead survive.
- The 3-consecutive-clean-passes discipline before deploy.

---

## 7. Phasing

**Phase 1 — variants (no model calls).** Schema, accessors, picker, Templates
screen. Ships the "one per type" fix on its own and is useful immediately
with hand-made templates.

**Phase 2 — auto-conversion.** Proposal, deterministic verification, review
screen.

**Phase 3 — Model C generated sections.** Per-section insertion points, real
per-marker value mapping (which also fixes the "every content marker gets the
whole document" defect in Model A).

Phase 1 is roughly half a session, Phase 2 a session, Phase 3 a session.
Phase 1 alone is worth shipping.

---

## 8. Decisions needed from Jordan

1. **Model B or Model C** (section 1). Recommendation: C.
2. **Phasing:** ship Phase 1 first, or build 1 and 2 together?
3. **Precedents:** can you supply two or three unredacted precedents per
   document type to build against? Conversion quality cannot be evaluated
   honestly without real ones.
4. **Variant suggestion** from approved issues: wanted in v1, or later?
