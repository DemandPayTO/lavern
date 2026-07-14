# Research Memo — Plaintiff-Side Mediation Brief Best Practices (Ontario, Rule 24.1)

Prepared 2026-07-14 for the Starling mediation brief generator upgrade.
Method: deep-research run (5 search angles, 22 sources fetched, 95 claims
extracted, 25 verified by 3-vote adversarial panels; 25 confirmed 3-0, 0
refuted). Primary authorities are the published brief-drafting guidance of
three active Ontario employment mediators: Barry Fisher, Stuart Rudner, and
Mitchell Rose.

## The consensus model

Every verified source converges on the same shape for a plaintiff-side
wrongful dismissal brief at mandatory mediation:

1. **Abandon Form 24.1C; write a persuasive narrative.** Fisher: "Ignore Form
   24.1C. You can do a much better job on your own"; there is effectively no
   sanction for non-compliance, and "no one ever told a story by filling out a
   form." Rudner: do not paste pleading text; pleadings prohibit argument,
   briefs do not. (Fisher, Dynamite Mediation Briefs; Rudner, "Preparing a
   Kick-Ass Mediation Brief," 2022.)

2. **Short.** Rose (40 Tips, 2nd ed. 2021, Tip 16): limit the Statement of
   Issues to about 10 pages double-spaced; include only what the mediator is
   expected to read in its entirety; flat-fee mediators may charge overtime
   for reading long briefs. Rudner: the briefs are the mediator's only
   pre-hearing information, so facts must be digestible, not buried in prose.

3. **Lead with a key-facts table (the Bardal profile).** Rudner: "put a simple
   table at the beginning" covering length of service, age at dismissal,
   position, reporting relationship, compensation components, relevant
   contractual terms, mitigation efforts, and type of dismissal, indicating
   which points are contentious. Fisher (Practice Point 3): age with DOB,
   exact service dates, position, full compensation package (base, bonus,
   benefits, car), and special circumstances affecting re-employability, "up
   front, preferably in bullet form."

4. **Fully itemized damages calculation, netted honestly.** Fisher (Practice
   Point 8): show every detail — base over the notice period, bonus (e.g.
   three-year average), benefits, car benefit — then DEDUCT ESA amounts paid
   and mitigation earnings to a net figure, with "an argument justifying
   every number."

5. **Comparable cases beat legal argument.** Fisher does not want the Bardal
   quote or argument on settled law; he wants a comparable-case report (his
   reference is the Wrongful Dismissal Database) showing what similar
   plaintiffs were awarded.

6. **Disclose the complete negotiation history.** Fisher (Practice Point 7):
   include copies of all Rule 49 offers whether or not still open, monies
   already paid, benefits continued; "dollar amounts referred to in pleadings
   and demand letters are not real offers. If that is all you have done, be
   honest and tell me that there has been no real negotiations." Rose:
   complete history of settlement offers belongs in the Statement of Issues.
   (Disclosure to a mediator in a confidential brief does not offend Rule
   49.06, which restricts disclosure to the court — verifier analysis, not a
   cited authority.)

7. **Candour about weaknesses is persuasive.** Fisher: a real just-cause
   issue must be addressed head-on — "get your version out on the table
   first"; counsel lose credibility when the defence brief reveals warning
   letters the plaintiff's brief ignored; routinely overstated briefs cause
   the mediator to miss the strong points. Expressly abandoning weak
   positions is "an effective way to park the issue."

8. **Mitigation evidence in chart form.** Fisher: a dated chart of all
   mitigation efforts (date, company, position applied for, interviews,
   offers) — "the thicker the better." Rose: mitigation summary plus the EI
   Statement of Account are "usually essential if there is to be a
   settlement."

9. **Tie the numbers to the settlement position.** Fisher links the itemized
   calculation to the plaintiff's Rule 49 offer to show the offer beats the
   likely trial outcome. Rudner: state where the litigation is, what is
   scheduled, and anticipated costs — "the best reason to settle is if it
   beats the alternative." Rose (Tip 27): consider making the first offer in
   the brief itself; anchoring bias rewards the first mover.

10. **Exhibits: key documents only, hyperlinked.** Rose: not all Schedule A
    productions; hyperlink documents and CanLII authorities rather than
    attaching cases; serve electronically and on time; the client should read
    both briefs before the mediation. The brief's true audience is the
    opposing party — written advocacy; the mediator is merely being educated.

11. **Register.** Fisher: inflammatory materials impede settlement. Credible,
    non-inflammatory tone throughout.

12. **Virtual mediations** settle at least as often as in-person (Rudner, OBA
    2022); no brief-drafting changes beyond electronic service and
    hyperlinking. Note the April 2022 presumptive in-person default for
    Toronto/Ottawa/Essex (mode-of-proceeding guidelines; confirm currency
    before relying on it).

## Caveats

- Fisher's two papers are circa 2009 and 2004 (still hosted on his active
  site; Rule 24.1 and Form 24.1C unchanged; his worked figures are 2008-09
  dollars). Rudner (2022) and Rose (2020/2021) are current.
- The author base is narrow (three mediators) but is exactly the source class
  sought: mediators stating what they want to receive.
- NOTHING SURVIVED VERIFICATION on presenting aggravated/moral/punitive
  damages (Honda) or Human Rights Code overlays in the brief, nor on explicit
  floor/target/ceiling presentation of the settlement range. These remain
  open questions; the generator keeps Starling's existing treatment for them.

## Design decisions for the generator (deterministic-first)

- The Bardal profile table, itemized damages table, comparable-case table,
  and negotiation-history table are built DETERMINISTICALLY from the matter
  record (intake, damages estimate, case-comparables engine, negotiation
  ledger) and prepended to the brief. The model never touches the numbers.
- The narrative prompt is rewritten to the consensus model: persuasive
  narrative addressed to the opposing party, concise, candour-forward,
  no settled-law recitation, negotiation history acknowledged honestly,
  mitigation chart referenced when present, settlement position tied to the
  litigation alternative, non-inflammatory register.
- Where the matter lacks data for a table (no comparables configured, no
  offers recorded, no mitigation entries), the table is omitted and a lawyer
  review flag says exactly what is missing, in Fisher's spirit of honesty.

## Sources (verified)

- B. Fisher, "Dynamite Mediation Briefs and Minutes of Settlement"
  (barryfisher.ca/papers/Dynamite_Mediation_Briefs.pdf)
- B. Fisher, "Ten Topics That Frequently Arise in Wrongful Dismissal
  Mediations" (via ellynlaw.com)
- S. Rudner, "Preparing a Kick-Ass Mediation Brief" (rudnerlaw.ca, 2022)
- S. Rudner, "How to Win at Mediating Employment Law Claims" (OBA, Nov 2022)
- M. Rose, "40 Tips for Better Mediation" (mitchellrose.ca, 2020; 2nd ed.
  Dec 2021)
- OBA L&E Section, "Virtual Mediations — Tips and Trends" (Jan 2021)
