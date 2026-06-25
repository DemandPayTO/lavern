# DemandPay Starling — UI/UX Overhaul Plan

**Author:** Jordan Haworth (CLO) + Claude Code
**Date:** June 25, 2026
**Status:** Draft — use Claude Cowork to design mockups before implementation
**Goal:** Transform Lavern's generic legal platform UI into a purpose-built Ontario employment law tool for law firms

---

## 1. Problem Statement

Lavern's UI was designed as a generic multi-agent legal platform. The current interface:
- Uses jargon ("Counsel", "Review", "Full Bench") that means nothing to an employment lawyer
- Doesn't guide the user toward specific employment law tasks
- Doesn't reflect DemandPay's brand identity
- Presents cost estimates that feel high and are confusing
- Requires the user to understand the underlying agent architecture to use it

The overhaul should make Starling feel like a **purpose-built employment law tool**, not a configurable AI platform.

---

## 2. Design Principles

1. **Task-first, not agent-first.** The lawyer thinks "I need to draft a demand letter", not "I need to configure an adversarial workflow with 5 agents."
2. **DemandPay branding.** Navy (#0f1a2e), orange (#ea580c), cream (#faf8f5). Georgia headings. Sharp corners. The DemandPay logo with colored dots.
3. **Progressive disclosure.** Show the simple action first. The agent pipeline, debate board, and verification passes are visible during processing, not before.
4. **Employment law vocabulary.** Every label, button, and description uses terms an Ontario employment lawyer would use.
5. **Cost transparency without anxiety.** Show estimated cost AFTER the user selects a task, not as the primary UI element.

---

## 3. Proposed Screen Flow

```
Dashboard → Task Selection → Upload/Input → Processing → Results → Export
```

### Screen 1: Dashboard (replaces Landing/QuickStart)

**Current:** "Your firm is ready. 30+ agent experts." + Counsel/Review/Full Bench cards.

**Proposed:** A clean dashboard showing:

```
┌─────────────────────────────────────────────────┐
│  [DemandPay Logo]              [My Cases] [Settings]  │
│                                                       │
│  Welcome back, [Lawyer Name]                          │
│                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ 📋       │ │ 📄       │ │ ⚖️       │              │
│  │ Complete  │ │ Review a │ │ Draft a  │              │
│  │ Intake   │ │ Document │ │ Document │              │
│  │          │ │          │ │          │              │
│  │ Upload   │ │ Upload   │ │ Select   │              │
│  │ transcript│ │ agreement│ │ document │              │
│  │ or notes │ │ or letter│ │ type     │              │
│  └──────────┘ └──────────┘ └──────────┘              │
│                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ 🔍       │ │ 🤝       │ │ 📊       │              │
│  │ Assess   │ │ Analyze  │ │ Extract  │              │
│  │ a Case   │ │ Settlement│ │ Data    │              │
│  │          │ │ Options  │ │          │              │
│  │ Quick    │ │ Review   │ │ Pull key │              │
│  │ assessment│ │ offer or │ │ facts from│              │
│  │ of merits│ │ negotiate│ │ documents│              │
│  └──────────┘ └──────────┘ └──────────┘              │
│                                                       │
│  Recent Matters                                       │
│  ┌─────────────────────────────────────────────┐      │
│  │ Smith v Acme Corp — Demand letter drafted   │      │
│  │ Jones v BigCo — Intake completed            │      │
│  │ Lee v TechFirm — SOC in progress            │      │
│  └─────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────┘
```

**6 task cards:**

| Card | Label | Description | Maps to workflow |
|------|-------|-------------|-----------------|
| 📋 | Complete Intake | Upload intake transcript or notes. AI identifies issues, missing docs, and follow-up questions. | counsel (intake_analysis) |
| 📄 | Review a Document | Upload an employment agreement, termination letter, or other document for analysis. | review (employment_agreement) |
| ⚖️ | Draft a Document | Generate a demand letter, statement of claim, mediation brief, or motion materials. | adversarial (demand_letter / statement_of_claim) |
| 🔍 | Assess a Case | Get a quick assessment of the merits, risks, and recommended approach. | counsel (case_assessment) |
| 🤝 | Analyze Settlement | Review a settlement offer, calculate net recovery, assess whether to accept or counter. | counsel (settlement) |
| 📊 | Extract Data | Pull key facts, dates, and amounts from uploaded documents into structured format. | tabulate |

### Screen 2: Task Configuration (replaces Intake + Briefing)

After clicking a task card, the user sees a focused screen for that specific task.

**Example: "Draft a Document"**
```
┌─────────────────────────────────────────────────┐
│  ← Back                    Draft a Document     │
│                                                 │
│  What type of document?                         │
│                                                 │
│  ○ Demand Letter                                │
│  ○ Statement of Claim                           │
│  ○ Mediation Brief                              │
│  ○ Motion Materials                             │
│  ○ Counter-Offer Letter                         │
│  ○ Settlement Conference Brief                  │
│                                                 │
│  Upload supporting documents (optional):        │
│  ┌─────────────────────────────────────────┐    │
│  │  Drop files here or click to browse     │    │
│  │  Employment agreement, termination      │    │
│  │  letter, pay stubs, ROE, etc.           │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  Describe the situation briefly:                │
│  ┌─────────────────────────────────────────┐    │
│  │  e.g., "Client was terminated after     │    │
│  │  8 years as a marketing manager.        │    │
│  │  Employer offered 4 weeks."             │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  Estimated cost: ~$3-5                          │
│  Estimated time: ~3-5 minutes                   │
│                                                 │
│  [Start Drafting →]                             │
└─────────────────────────────────────────────────┘
```

**Key differences from current UI:**
- No mention of "workflows", "agents", or "debate boards"
- Document type is a simple radio list, not a dropdown with codes
- Cost estimate is secondary, not the headline
- File upload is integrated into the task flow
- Description is a free-text field, not a structured form

### Screen 3: Processing (replaces Working view)

Show the agents working in real-time, but framed as **steps in the process**, not as agents having a debate.

```
┌─────────────────────────────────────────────────┐
│  Drafting Demand Letter — Smith v Acme Corp     │
│                                                 │
│  ✅ Analyzing intake data                       │
│  ✅ Identifying legal issues                    │
│  ✅ Calculating entitlements (ESA + Bardal)     │
│  🔄 Drafting demand letter...                   │
│  ⬜ Stress-testing from employer's perspective  │
│  ⬜ Strengthening weak points                   │
│  ⬜ Verifying accuracy (8 checks)               │
│  ⬜ Final quality review                        │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │  Live Activity                          │    │
│  │                                         │    │
│  │  Employment Counsel is drafting the     │    │
│  │  demand letter based on 33 potential    │    │
│  │  damages heads...                       │    │
│  │                                         │    │
│  │  Issue found: Termination clause may    │    │
│  │  be void under Waksdale v Swegon       │    │
│  │  (2020 ONCA 391) [source: case_db ✓]   │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  Cost so far: $1.23 / $3.00 budget              │
│  ████████░░░░░ 41%                              │
└─────────────────────────────────────────────────┘
```

**Key differences:**
- Steps are described in lawyer terms ("Stress-testing from employer's perspective") not agent terms ("Red Team adversarial analysis")
- Source attribution visible in real-time (green checkmarks for verified sources)
- Cost tracking is a progress bar, not the headline
- The "debate board" activity is shown as "Live Activity" without requiring the user to understand multi-agent architecture

### Screen 4: Results (replaces Delivery view)

```
┌─────────────────────────────────────────────────┐
│  Demand Letter — Smith v Acme Corp    [Export ▼] │
│                                                 │
│  Quality Score: 92/100  ✅ PASS                 │
│                                                 │
│  Tabs: [Document] [Issues Found] [Source Map]   │
│         [Verification] [Cost Summary]           │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │  WITHOUT PREJUDICE                      │    │
│  │                                         │    │
│  │  June 25, 2026                          │    │
│  │                                         │    │
│  │  Dear [Employer],                       │    │
│  │                                         │    │
│  │  Re: Termination of [Client Name]       │    │
│  │                                         │    │
│  │  We are counsel for [Client Name]...    │    │
│  │  ...                                    │    │
│  │                                         │    │
│  │  [Source indicators visible inline]     │    │
│  │  ✓ = verified statute                   │    │
│  │  ✓ = verified case (from database)      │    │
│  │  ⚠ = web source (verify before use)     │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  [Download DOCX] [Download PDF] [Copy to Matter]│
└─────────────────────────────────────────────────┘
```

### Screen 5: My Cases (replaces My Cases + Archive)

List of all matters/engagements with status, last activity, and quick actions.

---

## 4. Components to Keep vs Replace

| Current Component | Keep/Replace | Notes |
|-------------------|-------------|-------|
| Landing page (QuickStart) | **Replace** | New task-card dashboard |
| Intake flow (matter type, client info) | **Simplify** | Reduce to task-specific forms |
| Briefing (AI interview) | **Keep** | But frame as "Tell us about the case" not "Brief the matter" |
| Strategy/Team selection | **Remove from default flow** | Auto-select based on task. Available in "Advanced" if lawyer wants to customize. |
| Working view (real-time agents) | **Redesign** | Show as process steps, not agent chat room |
| Delivery view | **Redesign** | Tabbed results with source attribution |
| My Cases | **Keep** | Update labels |
| Agent Builder | **Keep but hide** | Available in Settings for power users |
| Clawern dashboard | **Remove** | Not relevant for B2B employment law |
| Challenge view | **Remove** | Marketing feature, not needed |
| Demo tour | **Remove** | Replace with onboarding flow |

---

## 5. Branding Requirements

| Element | Specification |
|---------|--------------|
| Logo | DemandPay logo (three colored dots + DEMAND PAY text) |
| Primary colour | Navy #0f1a2e (headings, nav, primary buttons) |
| Accent colour | Orange #ea580c (CTAs, active states, highlights) |
| Background | Cream #faf8f5 (content area) |
| Frame | Warm gray #e8e5e0 (page background behind cards) |
| Card borders | Sharp corners (border-radius: 0) |
| Button radius | 2px only |
| Heading font | Georgia, 'Palatino Linotype', serif |
| Body font | system-ui, -apple-system, sans-serif |
| Success | Green #16a34a |
| Warning | Amber #d97706 |
| Danger | Red #dc2626 |

---

## 6. Implementation Approach

### Phase 1: Mockups (Claude Cowork)
- Design mockups for: Dashboard, Task Configuration, Processing, Results
- Use DemandPay brand colours and typography
- Test with a lawyer for clarity and usability

### Phase 2: Dashboard replacement
- Replace LandingView/QuickStartView with new task-card dashboard
- Wire task cards to existing workflow routing (already configured)
- Auto-select team based on task type (already done in router)

### Phase 3: Task configuration screens
- Create task-specific input screens (one per task type)
- Simplify intake flow — remove strategy/team selection from default path
- Keep advanced configuration accessible but hidden

### Phase 4: Processing view redesign
- Redesign WorkingView to show process steps instead of agent chat
- Map agent activities to human-readable step descriptions
- Show source attribution in real-time

### Phase 5: Results view redesign
- Redesign DeliveryView with tabs and inline source indicators
- Add DOCX/PDF export
- Add "Copy to Matter" for DemandPay integration

---

## 7. What NOT to change

- The agent prompts (already rewritten for Ontario employment law)
- The router logic (already configured for employment law workflows)
- The verification pipeline (8 passes, already configured)
- The debate board and MCP tools (backend infrastructure)
- The API server and WebSocket event streaming
- The session management and state persistence

The UI is a presentation layer over working infrastructure. Changing the UI should not affect any backend functionality.

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking existing functionality | All UI changes are component-level. Backend (API, agents, workflows) is untouched. |
| Losing features during redesign | Keep removed components (Clawern, Challenge, Agent Builder) in the codebase, just remove from navigation. Can be re-enabled. |
| Scope creep | Phase 1 (mockups) gates everything. No implementation without approved mockups. |
| Cost of redesign | The existing React components can be adapted, not rebuilt from scratch. Most changes are text, layout, and routing — not new functionality. |
