# Revision Loop — Spec (drafted 2026-08-04, awaiting Jordan's decisions)

Jordan's ask: upload a statement of claim, paste the client's feedback, and
have Starling implement it.

This closes the loop he described at the outset of the pilot work: draft,
send to the client, implement revisions, send back, then route to the
partner. Starling currently helps with the drafting and nothing after it.

---

## 1. What exists today (verified, not assumed)

Every generator writes from scratch: intake plus approved issues in, a
finished document out. **No generator accepts an existing draft as input,
and there is no revision path anywhere in the codebase.** The two adjacent
mechanisms are not this:

- The approval lane lets a reviewer edit in place or upload a revised Word
  file, but a human does the editing.
- `additionalContext` passes free text into a generation, but it produces a
  fresh draft rather than revising an existing one.

So this is new capability, built on two existing disciplines: the
extraction apply loop's per-item lawyer gate and quote grounding
([extraction-apply.ts](../../src/employment/extraction-apply.ts)), and the
paragraph diff built for the review lane
([document-reviews.ts](../../src/employment/document-reviews.ts)).

---

## 2. The shape

1. **Start.** From a generated document on a matter, or by uploading a DOCX
   that was edited outside Starling. Choose "Apply feedback".
2. **Paste the feedback** in whatever form it arrived: an email, a numbered
   list, notes from a call. (See section 6 for tracked changes.)
3. **Plan, do not edit.** One model call returns a REVISION PLAN: each
   piece of feedback mapped to the paragraphs it affects, with a proposed
   change and a classification. Nothing is modified yet.
4. **Lawyer reviews the plan item by item** — approve, reject, or edit the
   instruction. Same gate discipline as the extraction apply loop.
5. **Apply**, then show a paragraph-level diff of exactly what changed.
6. **Save as a new draft version**, so the previous version stays in the
   matter's draft history and nothing is overwritten.

---

## 3. Classification (why the plan step exists)

Each feedback item is one of:

- **Factual correction** — "I was hired in March 2016, not 2017."
- **Position change** — "I want to claim moral damages too."
- **Wording or tone** — "This paragraph reads as too aggressive."
- **Needs the lawyer** — a client characterisation that is not a pleadable
  fact ("say they fired me because they hated me"), an instruction that
  would change the legal theory, or anything the plan cannot ground in a
  specific paragraph.

The last category is the reason this is a plan rather than a rewrite.
A client's characterisation is not evidence, and a system that silently
pleads it has done real damage to the file.

---

## 4. Three non-negotiables

**Factual corrections must flow back to the intake, not only the document.**
If the hire date is wrong in the claim, it is wrong in the matter: every
future document repeats it and the limitation and notice calculations stay
wrong. A factual correction therefore updates the intake through the
existing merge path and recomputes gates and timeline
(`rebuildTimelinePreserving`, `evaluateGates`), exactly as an extraction
does. The document edit alone is the shallow half of the fix.

**Nothing outside an approved change may drift.** After applying, every
paragraph the lawyer did not approve a change to must be byte-identical to
before. Same verbatim-verification discipline as precedent alignment: if
the model reworded an untouched paragraph, the apply is rejected rather
than shown. A revision pass must not quietly restyle a pleading.

**The previous version survives.** Each apply writes a new entry to
`draftHistory` rather than replacing the document, so the lawyer can always
see and recover what the client actually commented on.

---

## 5. Interaction with the approval lane

The partner's "request changes" comment is the same mechanism pointed at a
different person. Once this exists, the approval lane's
`changesDescription` can feed the same planner, so the submitter gets a
proposed revision rather than a note to action by hand.

**Jordan decides** whether that is in v1 or follows.

---

## 6. Input formats

Prose feedback (email, list, call notes) is the v1 input and needs no
parsing beyond the model call.

**Tracked changes and Word comments are a different piece of work.** They
live in `word/comments.xml` and as `w:ins`/`w:del` runs in the document
XML, and reading them means walking that XML rather than the extracted
text. Worth doing if that is how the pilot firm's clients actually reply,
and unnecessary if they reply by email.

**Jordan decides** which he actually receives.

---

## 7. Cost and model use

Roughly $0.10 to $0.30 per revision round: editing is cheaper than
composing. One call for the plan; the apply itself is mechanical, and the
verbatim check is deterministic.

---

## 8. Security and tenancy

Matter-scoped like every other document route, under the caller's user id.
Uploaded DOCX parsed in process, size-capped, DOCX only. The feedback text
and the document go to the model on the existing generation path, so the
same disclosure position applies as for any generated document; the
uploaded file itself is stored on the matter like any other document.

---

## 9. Testing

- Verbatim property: untouched paragraphs byte-identical after apply, over
  a corpus of documents and feedback sets.
- Rejection: a plan that alters an unapproved paragraph is refused.
- Intake flow-back: a factual correction updates the intake and recomputes
  the timeline and gates, and a limitation date visibly moves.
- Refusal: a client characterisation lands in "needs the lawyer" rather
  than being applied.
- Version safety: the prior draft remains in `draftHistory`.
- Round trip in the browser, then the 3-consecutive-clean-passes discipline.

---

## 10. Phasing

**Phase 1** — prose feedback on a document already on the matter: plan,
review, apply, diff, new version. The complete loop for the common case.

**Phase 2** — factual corrections flow back to the intake with the
consequence diff (what the correction changes downstream). Deliberately
separate: it touches matter state rather than a document, and deserves its
own testing pass.

**Phase 3 — SHIPPED 2026-08-04.** Upload the Word file the client edited.
src/documents/docx-revisions.ts walks the OOXML directly (mammoth discards
both): comments come from word/comments.xml and are ANCHORED to the passage
they mark via commentRangeStart/End, tracked changes from inline w:ins and
w:del runs. Each is rendered as feedback prose and fed to the same planner,
so the lawyer still approves every item and nothing bypasses the review.
A file with no comments and no tracked changes is reported as clean rather
than an error, since replacing a draft outright is a separate act.

Phase 1 is a session; Phase 2 is a session; Phase 3 depends on section 6.

---

## 11. Decisions needed from Jordan

1. **Feedback format**: prose, or tracked changes and Word comments?
2. **Approval lane**: wire the partner's "request changes" into the same
   planner in v1, or later?
3. **Phasing**: Phase 1 alone first, or 1 and 2 together? (My
   recommendation: together, because a factual correction that fixes only
   the document and leaves the matter wrong is the kind of half-fix that
   causes a missed limitation date.)
4. **Refusal appetite**: how aggressively should the planner push items
   into "needs the lawyer"? Erring toward refusal is safer and noisier.
