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
3. **Align (Jordan's improvement, 2026-08-04 — replaces the single-document
   model proposal).** Give Starling THREE OR MORE precedents of the same
   type and fact pattern, and diff them against each other. Text that
   recurs across all of them is the firm's boilerplate; text that varies is
   case-specific and becomes a placeholder. The signal is structural, not
   inferred, so no model decides what the firm's language is.
   Proven on three synthetic medical-leave demand letters: the alignment
   correctly held the whole Human Rights Code paragraph as boilerplate and
   isolated the client, employer, address, job title, hire and termination
   dates, salary, notice range, settlement figure, and deadline, showing
   the three real values behind each slot.
4. **Classify the varying spans** into placeholder names, in this order of
   preference: (a) cross-reference each precedent against the matter it came
   from, which is exact and fully deterministic; (b) pattern-match the
   obvious ones (currency, dates, addresses); (c) as a last resort, send
   only the SHORT VARYING FRAGMENTS to a model for labelling. Option (c)
   means the model never sees the firm's boilerplate at all — only values
   like ["Vera Nunes", "Tess Vega", "Marcus Diallo"].
5. **Structure.** Paragraphs present in some precedents but not others are
   optional sections, mapping to the conditional blocks the injector already
   supports (`{{#SECTION}}...{{/SECTION}}`).
6. **Review.** Side-by-side screen: the aligned skeleton with proposed
   placeholders highlighted, and the values observed behind each. Per span:
   accept, reject, or change which placeholder it maps to. Nothing is saved
   until the lawyer confirms.
7. **Save.** Store the template with its placeholder map and variant label.

**Cost:** $0 for the alignment itself, which is pure algorithm. Only the
optional labelling step (4c) costs anything, and it sees fragments rather
than documents.

**Redaction, revisited.** The 2026-07-20 finding was that black-box
redactions defeat SINGLE-document inference, and that stands. Alignment may
survive them: it needs to know WHERE the case-specific text is, not what it
says, and a redacted region simply presents as a varying span. Unverified
against real redaction styles — test before relying on it.

**Requirement:** three or more precedents of the same type and fact
pattern. Two works but is weaker, since a coincidentally shared phrase
cannot be told from real boilerplate. Precedents stay inside Starling.

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

**Phase 3 — Model C generated sections. SHIPPED 2026-08-04.**
src/employment/generated-sections.ts splits generated output at its section
headings and maps each part to its own marker, so a firm precedent that says
WHERE each part belongs receives the parts rather than one block.

- Sectioned mode engages only when a template names two or more distinct
  sections; a template using one whole-document marker keeps the old
  letterhead behaviour untouched.
- Content whose marker the template does not use is folded into the first
  used section rather than dropped. Losing a damages analysis because the
  precedent had no heading for it would be a quiet, serious failure.
- The demand-letter prompt now pins its h2 headings, because sectioning
  depends on them and the generator's structure had been varying run to
  run (verified: a run before the change emitted only the h1 title, and
  everything folded into the first section — safe, but not sectioned).
  The other generators still vary; pin their headings as each is wanted
  in sectioned templates.

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
