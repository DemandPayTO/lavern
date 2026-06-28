# DemandPay B2C UI Revamp — Claude Code Handoff

**Task:** Unify the DemandPay B2C app on the "Starling" design language.
**Visual target:** The six mockups in this folder (`landing.html`, `dashboard.html`, `intake.html`, `results.html`, `demand-letter.html`, `calculator.html`). Open them in a browser first — they are the source of truth for colour, type, spacing, and component styling.
**Nature of the work:** Unification + cleanup, **not** a rebuild. The audit found the app ~70% aligned, fragmented across three token systems. Presentation layer only — do not restructure components or touch Supabase/data logic.

---

## Phase 1 — Token consolidation (do this first)

Foundation step; shouldn't change any layout. Establish one source of truth in `frontend/tailwind.config.js`. Retire the overlapping `brand-*`, `pub-*`, and `dp-*` systems and the per-component inline JS colour constants.

Canonical tokens (match the mockups exactly):

| Token | Value | Use |
|-------|-------|-----|
| navy | `#0f1a2e` | primary text, headers, nav bg (retire `#0F1F3D` everywhere) |
| orange | `#ea580c` | primary CTA, active states |
| orange-2 | `#f26a3d` | logo dot 2 |
| orange-3 | `#ff8a5c` | logo dot 3 |
| cream | `#faf8f5` | page background |
| frame | `#e8e5e0` | section/band background |
| border | `rgba(15,26,46,0.12)` | card + input borders |
| muted | `#5a6472` | secondary text, labels, meta |
| green | `#16a34a` | success, "strong" indicators |
| red | `#dc2626` | errors, urgent flags |
| callout | `#eef1f6` | info callout background |

Rules:
- **Radius:** max `2px` (buttons/inputs/chips); cards = `0`. Remove `rounded-2xl` / `rounded-xl`.
- **Cards:** white bg, `1px solid` border token, **no shadow**. Only allowed shadows are 2px focus rings for accessibility.
- **Fonts:** swap **Playfair Display → Georgia** (`Georgia, 'Palatino Linotype', serif`) for all headings; body stays `system-ui, -apple-system, sans-serif`. Free system font — drop the Playfair web-font load (faster).
- Grep for hardcoded hex (`#0F1F3D`, `bg-slate-*`, old token names) and replace with tokens.
- Confirm the build is clean and nothing visually breaks before moving on.

---

## Phase 2 — Screen-by-screen mapping

| # | Component | Mockup | Notes |
|---|-----------|--------|-------|
| 1 | **Landing — `Home.jsx`** | `landing.html` | Biggest fix. Replace `bg-slate-900` with navy token; editorial card style; three feature cards (Calculate/Letter/Negotiate); trust section; navy footer with "not a law firm" disclaimer. |
| 2 | **Public calculator** | `calculator.html` | Replace `rounded-2xl shadow-xl` with `rounded-none border border-[rgba(15,26,46,0.12)]`. Centered card; ESA-minimum + common-law-range results; conversion CTA. Mockup has a working live calc you can mirror for output shape. |
| 3 | **Dashboard** | `dashboard.html` | Unify `#0F1F3D` → navy token; inline styles → Tailwind tokens. Keep it a **single-claim** view (estimate card, status chips, Estimate/Review/Negotiate tabs, "next step" banner) — not a caseload list. |
| 4 | **Intake** | `intake.html` | Already close — minimal changes. Confirm numbered progress bar (green done / navy active), cream/navy left-border limitation-period callout, dashed upload zone. |
| 5 | **Demand Letter — `DemandLetterFlow`** | `demand-letter.html` | Already close. Clean up inline styles to tokens; confirm issue toggle cards, serif document-preview frame, DOCX (orange) / PDF (navy-outline) export buttons. |
| 6 | **Results / entitlement page** | `results.html` | Split layout (breakdown table + "What This Means"); Bardal factors as highlighted cards; three CTA cards (orange / navy-outline / gray-outline). |

---

## Constraints

- **Canadian spelling + Ontario terms** throughout UI copy (analyse, licence, ESA, Bardal, Waksdale, HRTO); CAD figures. No US spelling or US-law references.
- **Accessibility:** preserve WCAG 2.0 AA — keep visible focus states (the 2px rings), semantic HTML, contrast minimums.
- **Tone:** consumer, not lawyer-facing. Plainer language, reassuring, one clear action per screen. Do not import B2B density.
- **Scope:** don't change routing, form/state logic, or Supabase calls — restyle only.

---

## Suggested order of operations

1. Phase 1 — show the token config and a diff of the colour/font replacements; confirm the build before touching screens.
2. Landing (`Home.jsx`) + Calculator — highest visual impact. Pause for review.
3. Dashboard, Intake, Demand Letter, Results.

---

*Mockups produced in Cowork, verified against Starling tokens (all colours, Georgia + system-ui, sharp corners, Canadian spelling, no US-law leaks). Companion to the B2B Starling mockups in `~/lavern/mockups/`.*
