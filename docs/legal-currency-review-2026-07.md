# Legal Currency Review — July 3, 2026

Every hard-coded legal proposition in Starling's prompts and deterministic
engine, verified against live sources. Prepared for lawyer sign-off (Jordan).

**Verdict summary: the codebase is in good shape.** One factual error found
(an effective date), three post-2024 cases to add, and one genuinely unsettled
question the prompts should acknowledge. Everything else verified current.

---

## 1. ERROR — fixed in this commit

| Item | Where | Was | Correct | Source |
|---|---|---|---|---|
| Small Claims increase effective date | `src/agents/prompts/paralegal.ts`, `src/agents/prompts/arbitration-specialist.ts` | "effective January 2025" | **October 1, 2025** (O. Reg. 42/25); appeal threshold also rose $3,500→$5,000 | [practicePRO](https://www.practicepro.ca/2025/10/ontario-small-claims-court-limits-increased-to-50000/), [Rudner Law](https://www.rudnerlaw.ca/small-claims-court-limit-increases/) |

## 2. NEW CASE LAW — added to the citation canon in this commit

The canon (`src/employment/citation-canon.ts`) is the checker that flags
unknown citations; adding verified cases prevents false "unknown case" flags.
These are canon-only additions — no generation prompt was changed.

| Case | Holding | Source |
|---|---|---|
| **De Castro v Arista Homes Ltd, 2025 ONCA 260** | ONCA: "cause" defined more broadly than ESA wilful-misconduct voids ALL termination provisions (Waksdale applied) | [Littler](https://www.littler.com/news-analysis/asap/ontario-canada-court-appeal-agrees-cause-termination-provision-was-unenforceable) |
| **Baker v Van Dolder's Home Team Inc, 2025 ONSC 952** | "At any time" without-cause clause void (follows Dufault) — **under appeal, see §3** | [Achkar Law](https://achkarlaw.com/cases/onsc/lessons-from-baker-v-van-dolders-home-team-inc/) |
| **Li v Wayfair Canada Inc, 2025 ONSC 2959** | Contra Baker: "at any time" language alone does NOT void the clause — **under appeal, see §3** | [Osler](https://www.osler.com/en/insights/blogs/employment-and-labour-law-blog/a-rare-common-sense-win-for-employers-in-ontario-li-v-wayfair/) |

Also noted but NOT added (citation number unconfirmed): *Jones v Strides
Toronto* (2025 ONSC, follows Li). Confirm the neutral citation before adding.

## 3. UNSETTLED LAW — needs your decision on prompt wording

**The "at any time" question is reserved at the ONCA.** Baker and Li were
heard together on **March 25–26, 2026; decision reserved** and, per every
source found, still pending as of this review. This is the biggest live issue
for Starling because the demand letter and SOC prompts lean on the
Waksdale/Dufault line to attack termination clauses.

**Proposed prompt change (awaiting your approval):** add to the demand-letter
and SOC system prompts:

> Termination-clause analysis: distinguish grounds. Overbroad "cause"
> definitions (Waksdale, 2020 ONCA 391; De Castro, 2025 ONCA 260) and
> below-ESA entitlements (Machtinger) are settled appellate law — plead with
> confidence. The "at any time / sole discretion" ground (Dufault ONSC
> reasoning; Baker) is contested (Li, Jones contra) and under reserve at the
> Court of Appeal — plead it as an additional ground where available, but do
> not rest the clause attack on it alone, and flag it for lawyer review.

And to the red-team/moot context: employer's counsel will cite Li v Wayfair
and Jones v Strides against any "at any time" argument.

**Action for you:** approve/edit that wording, and when the ONCA releases
Baker/Li, tell me the outcome — it's a one-line canon update plus a prompt
adjustment either way.

## 4. VERIFIED CURRENT — no change needed

| Proposition | Where in code | Status |
|---|---|---|
| Small Claims cap $50,000; excess abandoned per CJA s.23 | soc-generator, timeline-generator, paralegal, arbitration-specialist | ✅ current ([O. Reg. 42/25](https://www.ontario.ca/laws/regulation/r25042)) |
| Simplified Procedure $50,001–$200,000 (Rule 76); 5-day trial cap | soc-generator, timeline-generator, paralegal | ✅ current ([ontario.ca](https://www.ontario.ca/page/civil-claims-simplified-procedure)) |
| `recommendProcedure()` boundaries ≤50K / ≤200K / above | timeline-generator.ts:282 | ✅ matches |
| Civil limitation 2 years (Limitations Act 2002, s.4) | timeline-generator | ✅ current |
| HRTO 1-year limitation (Code s.34(1)); s.34(11)/s.46.1 election | application-generator, arbitration-specialist | ✅ current ([HRLSC](https://hrlsc.on.ca/how-to-guides/limitation-periods/)) |
| ESA complaint 2-year limit; s.97 civil-action bar; s.74 reprisal reverse onus | application-generator, arbitration-specialist | ✅ current |
| ESA notice cap 8 weeks (s.57); severance cap 26 weeks (s.63–65); severance at 5 yrs + $2.5M payroll | employment-intake.ts analyze, application-generator, employment-counsel | ✅ current for 2026 ([Samfiru Tumarkin](https://stlawyers.ca/law-essentials/severance-pay/severance-pay-ontario/), [ontario.ca ESA guide](https://www.ontario.ca/document/your-guide-employment-standards-act-0/severance-pay)) |
| Dufault v Ignace: 2024 ONSC 1029, aff'd **2024 ONCA 915** (Dec 19, 2024, decided on for-cause grounds) | citation canon | ✅ correct ([Mathews Dinsdale](https://mathewsdinsdale.com/court-of-appeal-confirms-unenforceability-of-termination-clauses-in-dufault-appeal/)) |
| Full 18-case canon citations (Bardal, Waksdale, Machtinger, McKinley, Potter, Honda, Wallace, Ceccol, Whiten, Matthews, Shafron, Evans, Bowes, Paquette, Rahman, Fraser) | citation-canon.ts | ✅ no contradictions found |

## 5. REFINEMENTS worth making (your call, low urgency)

1. **"Global payroll"** — the $2.5M severance threshold is *worldwide* payroll
   (Hawkes v Max Aicher (North America) Ltd, 2021 ONSC 4290). Prompts say
   "payroll of $2.5M+"; adding "global" strengthens plaintiff-side analysis
   against employers who undercount.
2. **Jan 1, 2026 ESA job-posting rules** (compensation disclosure, AI
   transparency) — not relevant to termination practice; no action needed.
   Noted so you know it was considered.
3. **Consolidation** — these numbers live in ~8 files. Recommend a
   `src/employment/legal-parameters.ts` single source with a `lastVerified`
   date and a drift test, so the next review is a one-file diff. I'll build
   it on your go-ahead (mechanical, no value changes).

## Review process going forward

This review should re-run: (a) when Baker/Li is released, (b) every quarter,
(c) before any new practice-area expansion. The eval battery
(`scripts/eval-battery.ts`) plus this memo template make it a ~1-hour cycle.

Sources: [practicePRO](https://www.practicepro.ca/2025/10/ontario-small-claims-court-limits-increased-to-50000/) · [Rudner Law — Small Claims](https://www.rudnerlaw.ca/small-claims-court-limit-increases/) · [O. Reg. 42/25](https://www.ontario.ca/laws/regulation/r25042) · [HRLSC — Limitation Periods](https://hrlsc.on.ca/how-to-guides/limitation-periods/) · [Mathews Dinsdale — Dufault ONCA](https://mathewsdinsdale.com/court-of-appeal-confirms-unenforceability-of-termination-clauses-in-dufault-appeal/) · [Littler — De Castro](https://www.littler.com/news-analysis/asap/ontario-canada-court-appeal-agrees-cause-termination-provision-was-unenforceable) · [Achkar — Baker](https://achkarlaw.com/cases/onsc/lessons-from-baker-v-van-dolders-home-team-inc/) · [Osler — Li v Wayfair](https://www.osler.com/en/insights/blogs/employment-and-labour-law-blog/a-rare-common-sense-win-for-employers-in-ontario-li-v-wayfair/) · [Rudner — Baker/Li appeals](https://www.rudnerlaw.ca/baker-and-li-appeals-delayed/) · [Bennett Jones — Li & Jones](https://www.bennettjones.com/Insights/Blogs/Termination-At-Any-Time-A-Review-of-Recent-Developments) · [McCarthy — ESA updates 2025/2026](https://www.mccarthy.ca/en/insights/blogs/canadian-employer-advisor/ontario-employers-need-to-know-employment-standards-act-updates-whats-new-for-2026-and-what-changed-in-2025) · [ontario.ca — Simplified Procedure](https://www.ontario.ca/page/civil-claims-simplified-procedure) · [ontario.ca — ESA severance guide](https://www.ontario.ca/document/your-guide-employment-standards-act-0/severance-pay)
