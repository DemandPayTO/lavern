# Factums and Trial Submissions in Ontario — Research for the Starling Factum Generator

**Date:** 2026-08-17. **Purpose:** ground the Small Claims factum / trial-submissions
generator (and the forum-aware factum path generally) in the actual Rules, practice
directions, and drafting conventions rather than memory. Sources are Ontario legal
authorities only (e-Laws, the Superior Court and Court of Appeal, CanLII).

> Product framing, up front. In Ontario the word "factum" is a term of art for a
> **formal** written argument governed by the Rules of Civil Procedure — used on
> **motions** (including Rule 20 summary judgment), **applications**, and **appeals**.
> The **Small Claims Court has no factum** and no rule requiring one; its trials are
> deliberately informal. What a lawyer hands up at a Small Claims trial is best called
> **written closing submissions** (a "trial brief"), and it is optional but often
> valued. So the generator must be **forum-aware**: a Rules-of-Civil-Procedure factum
> for the Superior Court, and an informal-but-organised **trial submissions** document
> for Small Claims. The legal *argument* is ~80% shared; the *framing, format, and
> citation rigour* differ.

---

## 1. What a factum is, and what it is for

A factum is a party's **written legal argument**: a concise, persuasive roadmap that
tells the court what the party seeks, the material facts, the legal issues, and why the
law and authorities require the result sought. It is not evidence (that lives in
affidavits, the trial record, or exhibits) and not a pleading (that is the claim or
defence). Its job is persuasion and orientation: a good factum lets a judge grasp the
case and the winning path before argument, and follow along during it.

Two consequences flow from this that shape everything below:

- **Argument, not narrative.** A factum asserts a legal conclusion for each issue and
  marshals facts + authority to compel it. It is organised by *issue*, not by
  chronology (the chronology belongs in the facts section).
- **Every proposition is anchored.** Facts are anchored to the record (affidavit
  paragraph, exhibit, or, at trial, a witness's evidence); law is anchored to a pinpoint
  citation. Unanchored assertion is the cardinal sin.

---

## 2. Superior Court factum — the formal instrument

### 2.1 When a factum is required or expected

- **Summary judgment (Rule 20):** a factum is **required** on a Rule 20 motion
  (Rule 20.03). The whole point of Rule 20 post-*Hryniak* is that the motion record plus
  the factums let the judge decide without a trial.
- **Motions generally (Rule 37):** factums are **required for long motions** and
  **encouraged for all other motions** unless the court orders otherwise (Consolidated
  Civil Provincial Practice Direction). A motion factum **must not exceed 20 pages**
  without leave.
- **Applications (Rule 38):** a factum is required.
- **Appeals (Rule 61):** required; the appellant's factum structure in Rule 61.11 is the
  canonical model the whole system borrows.

### 2.2 The parts of a factum

The **appeal** factum (Rule 61.11) is the template everything else adapts. Its parts:

1. **Part I** — a statement identifying the party and the court/tribunal appealed from,
   and the result below. *(Appeal-specific; on a motion this collapses into the overview.)*
2. **Part II** — a **concise overview** of the nature of the case and the issues.
3. **Part III** — a **concise summary of the facts** relevant to the issues, with
   references to the record (transcript / exhibits / affidavit paragraphs).
4. **Part IV** — a statement of **each issue**, each immediately followed by a
   **concise argument** with the law and authorities for that issue.
5. **Part V** — a statement of the **order** the court is asked to make, **including
   costs**.
6. **Schedule A** — the **list of authorities** (only cases actually cited).
7. **Schedule B** — the **text of the relevant statutes / regulations / by-laws**.

For a **motion / summary-judgment factum**, the field-standard adaptation (the shape our
existing `sj_factum` already uses, and the correct one) is:

- **PART I — OVERVIEW.** Two or three paragraphs: what the motion seeks and, for SJ, why
  there is *no genuine issue requiring a trial*.
- **PART II — THE FACTS.** The material facts, cross-referenced to the affidavit
  (`[Affidavit of X, para Y]`) because a motion is decided on the paper record.
- **PART III — ISSUES AND THE LAW.** Organised by issue; each issue stated, then argued
  with pinpoint authority.
- **PART IV — ORDER REQUESTED.** The precise relief and costs.
- **SCHEDULE A — AUTHORITIES; SCHEDULE B — LEGISLATION.**

Throughout, **paragraphs are numbered consecutively** (a factum convention and a
formatting rule).

### 2.3 Format (Rule 4.06.1 and the practice directions)

- **Font:** minimum **12-point**; Arial or Times New Roman encouraged.
- **Line spacing:** **double-spaced**, except **quotations longer than four lines** and
  **footnotes**, which may be single-spaced.
- **Paragraphs:** consecutively numbered.
- **Length:** **motion factum ≤ 20 pages** (Rule 37 / practice direction); **appeal
  factum ≤ 30 pages** historically, now **≤ 40 pages and ≤ 9,200 words** at the Court of
  Appeal — either ceiling requires leave to exceed. *The best factums in a wrongful-
  dismissal SJ class run well under twenty pages; brevity is a virtue, not a constraint
  to fill.*
- **Certificate of authenticity:** Rule 4.06.1(2.1) — the factum must include a
  **statement signed by the lawyer certifying satisfaction as to the authenticity of
  every authority cited.**

### 2.4 Citations in a Superior Court factum

- **Hierarchy of sources** (Court of Appeal Reference Guide, tracking the McGill Guide):
  **neutral citation first**, then official/semi-official reporter, then CanLII, then
  subscription databases. **Use the neutral citation whenever one exists.**
- **Pinpoint everything:** every case citation carries a **paragraph reference**
  (`at para 12`), and each is **hyperlinked to a publicly accessible source (CanLII)**
  including a link to the applicable paragraph.
- **Case format:** *Name v Name*, neutral cite, (parallel reporter optional).
  Example: *Waksdale v Swegon North America Inc*, 2020 ONCA 391.
- **Statute format:** *Act Title*, R.S.O. 1990, c. X, s. Y. Example:
  *Employment Standards Act, 2000*, S.O. 2000, c. 41.
- **Book of authorities not required** when the factum hyperlinks every authority to a
  public site; a **compendium** (key passages, hyperlinked) is used for oral argument.
- **Never invent a citation.** (This is also a hard platform rule — Rule 2.) Cite only
  authorities in retrieved context or verified on CanLII; if it cannot be verified, do
  not cite it.

---

## 3. Small Claims Court — no factum, informal by design

### 3.1 The governing frame

- **Courts of Justice Act, s. 25:** the Small Claims Court "**shall hear and determine
  in a summary way** all questions of law and fact and may make such order as is
  considered just and agreeable to good conscience." Summariness is the animating
  principle.
- **CJA s. 27:** the court may admit **any oral or written evidence it considers
  relevant**, and is **not bound by the ordinary rules of evidence** — hearsay and
  documents come in far more freely than in the Superior Court.
- **Rules of the Small Claims Court (O. Reg. 258/98):** their stated object (Rule 1.03)
  is the "**just, most expeditious and least expensive**" determination on the merits, in
  accordance with CJA s. 25. **Rule 17** governs the trial; **Rule 18** governs evidence.
  **The Rules of Civil Procedure do not apply**, and **there is no factum and no rule
  requiring written argument.**

### 3.2 What actually happens, and where written submissions fit

- **Trial (Rule 17):** each party "tells their story and presents evidence." The MAG
  *Guide to Procedures in Small Claims Court* is explicit and telling in what it does
  **not** contain: it advises preparing "a list of the points you wish to make," organising
  "in the order that the events actually happened," bringing "the original documents and
  at least three copies," and starting by "telling the judge briefly what the case is
  about." It says **nothing** about factums, written submissions, books of authorities, or
  formal legal argument — because none is required.
- **But written closing submissions are permitted and often welcomed.** Because s. 27
  lets the court receive written material and s. 25 prizes efficiency, Deputy Judges
  routinely accept — and busy ones appreciate — a **short written closing submission /
  trial brief** that: (a) frames the issues, (b) ties the evidence heard to each issue,
  (c) states the law in plain terms with a handful of key authorities, and (d) sets out
  the damages math and the judgment sought. It is a persuasion tool, not a filing
  obligation. Keep it short and practical; the Deputy Judge wants the answer, not a
  Superior Court factum.
- **Settlement conference (Rule 13):** mandatory, informal, confidential. Rule 13
  requires the **List of Proposed Witnesses (Form 13A)** and the documents to be served
  and filed **at least 14 days before**. The judge asks each side for a **brief oral
  summary** and gives a view of the likely outcome. There is no prescribed written brief,
  but a concise written summary of issues, admitted vs disputed facts, the plaintiff's
  position, and a realistic settlement number is useful and is exactly what our existing
  `settlement_conference_brief` (forum-aware, Rule 13 vs Rule 50) produces.

### 3.3 What a Small Claims *trial submissions* document should contain

A right-sized Small Claims trial brief / written closing submissions, in plain register:

1. **Introduction** — who the parties are, what the claim is, and the judgment sought,
   in two or three sentences.
2. **The facts / evidence** — the material facts **as established by the evidence heard
   at trial** (witness testimony and trial exhibits), in chronological order, referring
   to witnesses and exhibit numbers (not to an affidavit — there is no motion record).
3. **The issues** — a short list of what the court must decide.
4. **The law and argument** — organised by issue; the legal test in plain words, a few
   real authorities, and the application to the facts. In wrongful dismissal this is the
   reusable core (Part 5 below).
5. **Damages** — the calculation (notice period, the resulting figure, less mitigation
   and amounts paid), so the number is transparent and easy to adopt.
6. **Relief sought** — judgment in a stated amount, prejudgment interest under the CJA,
   post-judgment interest, and **costs (capped by Rule 19, generally 15% of the amount
   claimed** plus disbursements, with more available for bad-faith conduct).
7. **(Optional) list of authorities** — the handful of cases, neutral-cited.

What is **wrong** for Small Claims and must never be copied from a Superior Court factum:
the summary-judgment framing (*"no genuine issue requiring a trial," Hryniak,* Rule
20.04), affidavit-paragraph references, Rule-20 relief, and Superior-Court page/format
rigour. The regime cited must be the **CJA / O. Reg. 258/98**, not the Rules of Civil
Procedure.

---

## 4. Superior Court factum vs Small Claims trial submissions — the delta

| Dimension | Superior Court factum | Small Claims trial submissions |
|---|---|---|
| Governing regime | Rules of Civil Procedure (Reg 194), Rule 4.06.1, 20.03, 37, 38, 61 | *Courts of Justice Act* ss. 25, 27; O. Reg. 258/98 (Rules of Civil Procedure do **not** apply) |
| Required? | Yes on SJ / applications / long motions / appeals | No — optional persuasion aid |
| Central argument | The merits **plus**, for SJ, "no genuine issue requiring a trial" (*Hryniak*) | The merits, argued on the evidence heard; **no** SJ framing |
| Evidence reference | Affidavit paragraphs / motion record | Witness testimony + trial exhibit numbers |
| Structure | Parts I–IV(+V), Schedules A & B, numbered paragraphs | Introduction / Facts / Issues / Law / Damages / Relief |
| Format | 12 pt, double-spaced, ≤ 20 pp (motion), certificate of authenticity | Short, plain, practical; no prescribed format |
| Citations | Neutral cite first, pinpoint paras, CanLII hyperlinks, authenticity certificate | A few key authorities, neutral-cited; rigour welcome but not mandated |
| Costs | As argued; costs submissions | Rule 19 cap (~15% of claim) + disbursements |
| Monetary ceiling | none | $35,000 |

**The shared ~80%** is the wrongful-dismissal legal argument itself (Part 5). The
differing ~20% is framing, evidence-reference style, format, and the costs regime.

---

## 5. The reusable wrongful-dismissal argument (issue library)

These are the recurring issues a plaintiff-side factum/trial-submissions argues, with the
governing authorities. This is the content the generator assembles from the matter's
**approved issues** (never inventing an issue the intake did not support). Cite only what
the approved issues raise.

- **Reasonable notice (the Bardal factors).** *Bardal v Globe & Mail Ltd* (1960),
  24 D.L.R. (2d) 140 (Ont H C) — notice is fixed by the character of employment, length
  of service, age, and availability of similar employment. Apply the factors to *this*
  plaintiff to support the claimed range.
- **Termination-clause enforceability.** *Waksdale v Swegon North America Inc*,
  2020 ONCA 391 — an unenforceable "for cause" provision voids the entire termination
  scheme; *Machtinger v HOJ Industries Ltd*, [1992] 1 S.C.R. 986 — a clause that dips
  below ESA minimums is void and common-law reasonable notice revives. Where the clause
  issue is approved, this is usually the lead argument (it converts a capped claim into a
  common-law one).
- **Just cause.** *McKinley v BC Tel*, 2001 SCC 38 — cause requires a **contextual,
  proportionate** analysis; the **employer bears the onus**. Argue the employer cannot
  meet it.
- **Manner of dismissal / moral (aggravated) damages.** *Honda Canada Inc v Keays*,
  2008 SCC 39 — bad-faith conduct in the manner of dismissal grounds compensatory moral
  damages where it causes provable harm. Where approved, plead the specific conduct.
- **Human Rights Code damages** (where discrimination is an approved issue) — injury to
  dignity, feelings and self-respect under the *Code*, on the facts pleaded.
- **Mitigation.** The plaintiff's efforts were reasonable; the **employer bears the onus
  of proving a failure to mitigate** and that suitable comparable work was available.
- **ESA minimums / statutory entitlements** (termination and severance pay, vacation,
  benefits continuation through the statutory notice period) as the floor beneath the
  common-law claim — *Employment Standards Act, 2000*, S.O. 2000, c. 41.

For a Small Claims matter the same issues are argued, but framed to the evidence heard
and to the $35,000 ceiling, and without the Rule 20 scaffolding.

---

## 6. Drafting best practices (both forums)

- **Issue-first, conclusion-first.** State the legal conclusion for each issue, then
  compel it with facts + authority. Judges read for the answer.
- **A real overview.** The first page should let the judge state the case and the result
  back to you. Front-load the theory of the case.
- **Assert, don't hedge; be concise.** The best wrongful-dismissal factums are short.
  Cut throat-clearing. One clean argument per issue beats three tentative ones.
- **Anchor every fact and every proposition.** Fact → record; law → pinpoint. No naked
  assertions.
- **Only cite what you will use**, and mark the passage you rely on. A short, curated
  authority set reads as mastery; a long one reads as padding.
- **Candor with the tribunal.** Deal with the obvious weakness rather than hiding it;
  credibility is the whole currency. (In Small Claims especially, Deputy Judges reward
  realism and penalise puffery.)
- **Match the register to the forum.** Superior Court: formal, Parts I–IV, numbered
  paragraphs, full citation rigour. Small Claims: plain, practical, short; the Deputy
  Judge wants the merits and the math, not a moot.
- **Never fabricate a citation** (platform Rule 2; Rule 4.06.1(2.1) authenticity
  certificate). Verify on CanLII or leave a `[LAWYER: authority]` marker.

---

## 7. Implications for the Starling generator (build spec)

1. **New document type: Small Claims trial submissions** (working id `scc_trial_submissions`
   or `trial_submissions`). Forum-aware; produces the §3.3 structure (Introduction /
   Facts-on-evidence / Issues / Law & argument / Damages / Relief-with-Rule-19-costs), in
   the plain Small Claims register, citing the CJA / O. Reg. 258/98 regime and **never**
   the Rule 20 / *Hryniak* scaffolding.
2. **Reuse the approved-issues engine.** Argument sections are assembled from the matter's
   approved issues, exactly as `sj_factum` does — the §5 issue library keyed to
   Bardal / Waksdale / Machtinger / McKinley / Honda / mitigation / ESA. Deterministic
   selection; the model writes the connective prose only.
3. **Deterministic figures.** Damages math (notice period → figure, less mitigation and
   amounts paid, net) computed in a `*-parts.ts`, not written by the model — same
   discipline as the demand letter and SOC.
4. **Forum switch, not a new engine.** The existing `sj_factum` already covers the
   Superior Court **summary-judgment** factum correctly (Parts I–IV, affidavit refs,
   Rule 20 framing, authorities). The new build is the **Small Claims trial** counterpart.
   A shared "factum argument" core can feed both, with a forum flag choosing framing,
   evidence-reference style (`[Affidavit, para X]` vs witness/exhibit), format, relief,
   and costs regime.
5. **Citation canon + verification.** Draw case citations from the firm's citation canon /
   retrieved context or verified CanLII; pinpoint paragraphs; emit `[LAWYER: verify]`
   rather than inventing. Neutral citation first.
6. **Reusable per-firm argument library (follow-up, not v1).** The natural extension the
   pilot asked for — store each recurring argument section (reasonable notice, mitigation,
   clause attack, moral damages) in the firm's settled wording, the SOC-node-library
   pattern applied to factum argument, so "similar across most wrongful dismissals" is
   captured once and reused with this matter's facts spliced in.
7. **Format outputs.** Small Claims: clean HTML → DOCX, plain headings, no Superior-Court
   chrome. Superior Court factum path (if extended beyond SJ): 12 pt, double-spaced,
   numbered paragraphs, Schedule A/B, authenticity certificate line.

---

## Sources

- [Rules of Civil Procedure, R.R.O. 1990, Reg. 194 (CanLII)](https://www.canlii.org/en/on/laws/regu/rro-1990-reg-194/latest/) — Rules 4.06.1, 20.03, 37.10, 61.11–61.12.
- [Practice Direction Concerning Civil Appeals — Court of Appeal for Ontario](https://www.ontariocourts.ca/coa/how-to-proceed-court/practice-directions-guidelines/practice-direction-civil/) — font, spacing, 40 pp / 9,200 words, citation certificate.
- [Consolidated Civil Provincial Practice Direction — Superior Court of Justice](https://www.ontariocourts.ca/scj/filing-procedures/provincial/consolidated-civil-provincial-practice-direction/) — 20-page motion factum, hyperlinking, compendium, authenticity.
- [Reference Guide for Citation Practices — Court of Appeal for Ontario](https://www.ontariocourts.ca/coa/how-to-proceed-court/practice-directions-guidelines/reference-guide-citation/) — hierarchy of sources, neutral citations, pinpoints, statute format.
- [How to Proceed with a Civil Appeal — Court of Appeal for Ontario](https://www.ontariocourts.ca/coa/how-to-proceed-court/civil-family/civil-appeal/) — Rule 61.11 factum parts, book of authorities.
- [O. Reg. 258/98 — Rules of the Small Claims Court (CanLII)](https://www.canlii.org/en/on/laws/regu/o-reg-258-98/latest/) — Rules 1.03, 13, 17, 18.
- [Courts of Justice Act, R.S.O. 1990, c. C.43 (CanLII)](https://www.canlii.org/en/on/laws/stat/rso-1990-c-c43/latest/) — ss. 25, 27 (Small Claims summary manner, evidence).
- [Guide to Procedures in Small Claims Court — Getting Ready for Court (Ontario)](https://www.ontario.ca/document/guide-procedures-small-claims-court/getting-ready-court).
- [Settlement Conferences — Small Claims Court, Superior Court of Justice](https://www.ontariocourts.ca/scj/areas-of-law/small-claims-court/settlement-conference-trial-management-conferences/) — Rule 13, Form 13A.
- Case law referenced: *Bardal v Globe & Mail Ltd* (1960), 24 D.L.R. (2d) 140; *Machtinger v HOJ Industries Ltd*, [1992] 1 S.C.R. 986; *McKinley v BC Tel*, 2001 SCC 38; *Honda Canada Inc v Keays*, 2008 SCC 39; *Hryniak v Mauldin*, 2014 SCC 7; *Waksdale v Swegon North America Inc*, 2020 ONCA 391.
