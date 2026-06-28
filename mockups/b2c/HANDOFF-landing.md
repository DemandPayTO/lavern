# Landing Page Restyle — Claude Code Handoff

**Task:** Apply the Starling editorial design language to the public landing page.
**Visual reference:** `~/lavern/mockups/b2c/landing-v2.html`
**Nature of the work:** This is a **restyle, not a rewrite.** Every piece of copy, every section, every link, and all SEO markup that exists today must remain. Change CSS/classNames and presentational wrappers only — not text, not structure, not data.

---

## Files in scope

- `frontend/src/pages/Home.jsx` — nav, hero, How It Works, ESA-vs-Common-Law bento, credibility strip, partners, AI pull-quote, FAQ, pricing, final CTA
- `frontend/src/components/layout/PublicFooter.jsx`
- `frontend/src/components/home/SeveranceCostComparison.jsx`
- Token source: `frontend/tailwind.config.js`

---

## The golden rule — preserve ALL content

Do not drop, shorten, merge, or reword any of:

- Hero headline ("Know your rights. Negotiate with confidence."), subhead, both CTAs, and the disclaimer line.
- The hidden `sr-only` SEO `<h1>`/keyword blocks and the **entire `<SEO>` JSON-LD payload** (Organization, LegalService, all 10 FAQPage entries). Leave the JSON-LD byte-for-byte.
- The floating hero card ("Settlement Evaluated", $47,200, ESA→Common law progress bar, "Demand Letter" ready badge).
- The rotating ribbon and all four trust phrases.
- All **four** How It Works step cards (titles, descriptions, the note, and the CTA links).
- The ESA vs. Common Law bento: both bar-chart pairs ($1,923 vs $25,000; $6,923 lawyer 30% vs $389), the footnote, the "Your Data, Protected" card with its three badges, and the "Built by an Ontario Lawyer" card.
- The credibility strip (100s / J.D. / Canadian data / $0 stats and descriptions).
- The partners section (Legal Innovation Zone, "Incubation Cohort 2026").
- The AI pull-quote section — keep the full Claude quote and the "Claude (Anthropic) — independently generated response" citation verbatim.
- All **ten** FAQ items (questions and answers exactly as written).
- All three pricing tiers (Free Tools $0, DemandPay Package $389 with its six features, Legal Services From $149), the Lawyer Review & Send add-on ($299) block, and the pricing footnotes — including `CheckoutButton` wiring.
- The final CTA section and both buttons.
- The footer: both link columns (Quick Links, Legal & Contact), the description, and the full legal disclaimer + copyright.

If you believe any content genuinely must move for the restyle to work, **stop and ask first** — do not remove it unilaterally.

---

## Styling changes to apply (the actual work)

1. **Nav** → change `bg-white` to the cream page background (`bg-pub-cream` / `#faf8f5`); keep the `border-b` and sticky behaviour. Keep using the real logo image (`/demandpay-logo.png`; `brightness-0 invert` on dark backgrounds).
2. **Remove all non-flat decoration**, replacing with solid Starling treatments:
   - `rounded-3xl`, `rounded-lg`, `rounded-t-lg` → sharp corners (cards `rounded-none`, buttons/inputs/chips `rounded-[2px]`).
   - `shadow-sm`, `shadow-2xl` → no shadow (1px border token only). Keep only 2px focus rings.
   - Final-CTA radial glow (`blur-3xl` orange) and the add-on `bg-gradient-to-r` accent bar → remove the blur/gradient; use a solid 3px orange top-border accent instead.
   - Hero floating card's glass look (`bg-white/10 border-white/20`) → solid Starling card (white card on the navy hero, or a `bg-white/5` solid panel — match `landing-v2.html`).
3. **Tokens** → unify on the canonical Starling set; retire the `brand-*` vs `pub-*` duplication so navy is `#0f1a2e` everywhere (not `#0F1F3D`). Cards: white bg, `1px solid rgba(15,26,46,0.12)`, no shadow, sharp corners.
4. **Fonts** → headings `Georgia, 'Palatino Linotype', serif`; body `system-ui`. Drop Playfair if still loaded.
5. **Remove emoji** used as UI/content: e.g. the `🇨🇦` flag in the credibility "Canadian data storage" stat — replace with a small typographic/CSS mark (keep the label and description text). Keep functional check icons (lucide `CheckCircle`) — those are SVG, not emoji.
6. Preserve framer-motion entrance animations, but ensure they respect `prefers-reduced-motion`.

---

## Constraints

- Canadian spelling throughout (already correct — keep it: "licenced", "analyse").
- WCAG 2.0 AA: keep the skip-to-main link, visible 2px focus states, contrast minimums.
- Don't touch routing, `createPageUrl`, `CheckoutButton`, auth state, or the `<SEO>` data.
- `SeveranceCostComparison.jsx` renders just above pricing — restyle it to match (sharp corners, navy/orange bars, no shadow) without changing its numbers or logic.

---

## Order of operations

1. Read `landing-v2.html` for the visual target, then unify tokens in `tailwind.config.js` and confirm the build.
2. Restyle the nav + hero, show a screenshot/diff, and pause for review.
3. Continue through the remaining sections and the footer.

After each file, show a diff so the reviewer can confirm no copy was lost.

---

*Companion to `HANDOFF.md` (full B2C migration) and the mockups in this folder. The mockup `landing-v2.html` is the visual target; the live `Home.jsx` content is authoritative and must be preserved in full.*
