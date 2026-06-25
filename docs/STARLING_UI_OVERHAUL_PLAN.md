# DemandPay Starling — UI/UX Overhaul Plan

**Author:** Jordan Haworth (CLO) + Claude Code
**Date:** June 25, 2026
**Status:** APPROVED — ready for Cowork mockup design
**Goal:** Transform Lavern's generic legal platform UI into a matter-centric Ontario employment law tool for law firms

---

## 1. Problem Statement

Lavern's UI was designed as a generic multi-agent legal platform. The current interface:
- Uses jargon ("Counsel", "Review", "Full Bench") that means nothing to an employment lawyer
- Is task-oriented when it should be matter-oriented (lawyers work on cases, not tasks)
- Doesn't track matter status or flag dormant files
- Doesn't reflect DemandPay's brand identity
- Presents cost estimates as the headline instead of the value
- Requires understanding agent architecture to use it
- Has no deadline monitoring or weekly digest

The overhaul makes Starling a **matter-centric employment law workbench** — the lawyer manages their caseload, and AI capabilities are actions within each matter.

---

## 2. Design Principles

1. **Matter-centric, not task-centric.** The lawyer thinks about cases (Smith v Acme), not workflows. Every action happens within a matter context.
2. **Zero manual status updates.** Starling infers matter status from activity. The lawyer never fills in a status dropdown.
3. **Surface urgency automatically.** Stale files and approaching deadlines appear prominently without the lawyer asking.
4. **Progressive disclosure.** Show the simple action first. Agents, debate boards, and verification passes are visible during processing, not before.
5. **DemandPay branding.** Navy, orange, cream. Georgia headings. Sharp corners. Coloured-dot logo.
6. **Employment law vocabulary.** Every label uses terms an Ontario employment lawyer would use.

---

## 3. Screen Flow

```
Dashboard (matters + quick actions)
  ├── New Matter → Intake flow → Matter created
  ├── Open Matter → Matter detail view
  │     ├── Draft Document → Processing → Results
  │     ├── Review Document → Processing → Results
  │     ├── View Timeline / Documents / Generated work
  │     └── Matter settings (client info, deadlines)
  └── Weekly Digest (email, automatic)
```

---

## 4. Screen Designs

### Screen 1: Dashboard (replaces Landing/QuickStart)

Two zones: Quick Actions (top) and My Matters (bottom).

```
┌─────────────────────────────────────────────────────────────┐
│  [DemandPay Logo ●●●]                    [My Cases] [⚙]    │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ + New Matter │  │ Draft       │  │ Review      │         │
│  │              │  │ Document    │  │ Document    │         │
│  │ Start a new  │  │             │  │             │         │
│  │ client file  │  │ Generate a  │  │ Analyze an  │         │
│  │              │  │ demand      │  │ employment  │         │
│  │ Upload intake│  │ letter,     │  │ agreement,  │         │
│  │ or describe  │  │ SOC, brief, │  │ termination │         │
│  │ the case     │  │ or motion   │  │ letter, or  │         │
│  │              │  │             │  │ other doc   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
│  My Matters                                    [+ New]      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🔴 Patel v MegaCorp         Limitation in 14 days  │    │
│  │    Action: File SOC before July 9, 2026             │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ⚠️ Jones v BigCo             No activity — 12 days  │    │
│  │    Missing: employment agreement, termination letter│    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ● Smith v Acme Corp         Demand letter drafted   │    │
│  │    Next: Send to employer or request review         │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ● Lee v TechFirm            SOC in progress         │    │
│  │    Next: Review draft, check limitation Feb 2027    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**3 quick action cards:**

| Card | Label | Description | Maps to |
|------|-------|-------------|---------|
| **+ New Matter** | Start a new client file | Upload intake transcript, employment docs, or describe the situation. Creates a new matter. | counsel (intake_analysis) |
| **Draft Document** | Generate a document | Select a matter → pick document type → Starling generates it | adversarial or counsel (depends on doc type) |
| **Review Document** | Analyze a document | Upload or select a document from a matter → clause analysis, risk scoring, issue identification | review workflow |

**My Matters list — auto-sorted by urgency:**
1. 🔴 **Urgent** — limitation period approaching (red, top of list)
2. ⚠️ **Stale** — no activity in 7+ days (amber, second)
3. ● **Active** — recent activity, on track (navy, normal)
4. ✅ **Completed** — all deliverables produced (green, collapsed by default)

---

### Screen 2: New Matter (replaces Intake + Briefing)

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back                         New Matter                  │
│                                                             │
│  Client Name                                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  e.g., Jane Smith                                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Employer Name                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  e.g., Acme Corporation                             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Describe the situation                                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  e.g., "Client terminated after 8 years as          │    │
│  │  marketing manager. Employer offered 4 weeks.       │    │
│  │  Client believes they were let go because of        │    │
│  │  a disability accommodation request."               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Upload documents (optional)                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Drop files here or click to browse                 │    │
│  │  Employment agreement, termination letter,          │    │
│  │  pay stubs, ROE, intake notes, etc.                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Key dates (optional — Starling will extract from docs)     │
│  Start date: [__________]  Termination date: [__________]   │
│                                                             │
│  [Create Matter & Analyze →]                                │
│                                                             │
│  Estimated cost: ~$0.50-1.00 for intake analysis            │
└─────────────────────────────────────────────────────────────┘
```

After clicking "Create Matter & Analyze":
- Matter is created with a matter number
- Uploaded documents are processed (tabulate agent extracts facts)
- Employment Counsel identifies legal issues
- Lawyer sees the matter detail view with results

---

### Screen 3: Matter Detail View (new — the core work screen)

```
┌─────────────────────────────────────────────────────────────┐
│  ← My Matters    Smith v Acme Corp    Matter #STR-2026-003  │
│                                                             │
│  Status: ● Active — Demand letter drafted                   │
│  Client: Jane Smith  |  Employer: Acme Corporation          │
│  Terminated: June 1, 2026  |  Tenure: 8.3 years             │
│  Limitation: June 1, 2028 (730 days remaining)              │
│                                                             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │
│  │Issues│ │Docs  │ │Draft │ │Time- │ │Notes │              │
│  │Found │ │      │ │      │ │line  │ │      │              │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘              │
│                                                             │
│  [Issues Found tab shown]                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ✅ Wrongful dismissal (without cause)    [Strong]   │    │
│  │    ESA notice: 8 weeks. CL range: 10-14 months.    │    │
│  │    Source: statute ✓                                │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ✅ Termination clause likely void       [Strong]    │    │
│  │    For-cause provision uses "just cause" not ESA    │    │
│  │    "wilful misconduct". Waksdale applies.           │    │
│  │    Source: case_db ✓                                │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ⚠️ Possible disability discrimination   [Moderate]  │    │
│  │    Termination followed accommodation request.      │    │
│  │    Source: ai_knowledge ⚠                           │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ⚠️ Bad faith — manner of dismissal      [Moderate]  │    │
│  │    Terminated same day as accommodation request.    │    │
│  │    Honda v Keays (2008 SCC 39) applies.             │    │
│  │    Source: case_db ✓                                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Actions                                                    │
│  [Draft Demand Letter]  [Draft SOC]  [Upload More Docs]     │
│  [Run Case Assessment]  [Export Summary]                    │
└─────────────────────────────────────────────────────────────┘
```

**Tabs:**
- **Issues Found** — Legal issues identified from intake + documents, with strength rating and source tags
- **Documents** — Uploaded documents + generated documents (demand letters, SOCs)
- **Draft** — Generate a new document (picks doc type, runs the pipeline)
- **Timeline** — Chronological history of everything done on this matter
- **Notes** — Lawyer's private notes (not processed by AI)

**Actions bar** — context-sensitive buttons based on matter status:
- If no demand letter exists: "Draft Demand Letter" is primary
- If demand letter exists but no SOC: "Draft SOC" is primary
- If limitation is approaching: "File SOC" is highlighted in red

---

### Screen 4: Processing View (redesigned from Working view)

When the lawyer clicks "Draft Demand Letter", they see the pipeline as human-readable steps:

```
┌─────────────────────────────────────────────────────────────┐
│  Drafting Demand Letter — Smith v Acme Corp                 │
│                                                             │
│  ✅ Step 1: Reading your documents                          │
│  ✅ Step 2: Identifying legal issues (found 4)              │
│  ✅ Step 3: Calculating entitlements                        │
│       ESA notice: 8 weeks ($14,615)                         │
│       Common law: 10-14 months ($79,167-$110,833)           │
│  🔄 Step 4: Drafting the demand letter...                   │
│  ⬜ Step 5: Stress-testing from employer's perspective      │
│  ⬜ Step 6: Strengthening weak points                       │
│  ⬜ Step 7: Verifying accuracy (8 checks)                   │
│  ⬜ Step 8: Final quality review                            │
│                                                             │
│  Live Activity                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Employment Counsel is calculating damages across    │    │
│  │ 33 potential heads...                               │    │
│  │                                                     │    │
│  │ Finding: Termination clause is void under           │    │
│  │ Waksdale v Swegon (2020 ONCA 391)                   │    │
│  │ [source: case_db ✓]                                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Cost: $1.23 / $5.00 budget   ████████░░░░ 41%             │
└─────────────────────────────────────────────────────────────┘
```

---

### Screen 5: Results View (redesigned from Delivery view)

```
┌─────────────────────────────────────────────────────────────┐
│  Demand Letter — Smith v Acme Corp            [Export ▼]    │
│                                                             │
│  Quality: 92/100 ✅ PASS    Cost: $3.47                     │
│                                                             │
│  [Document] [Issues] [Source Map] [Verification] [Cost]     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                                                     │    │
│  │  WITHOUT PREJUDICE                                  │    │
│  │                                                     │    │
│  │  June 25, 2026                                      │    │
│  │                                                     │    │
│  │  Dear Human Resources Department,                   │    │
│  │  Acme Corporation                                   │    │
│  │                                                     │    │
│  │  Re: Termination of Jane Smith                      │    │
│  │                                                     │    │
│  │  We are counsel for Jane Smith in connection with    │    │
│  │  her termination from employment with Acme          │    │
│  │  Corporation on June 1, 2026... ✓                   │    │
│  │                                                     │    │
│  │  Under the Employment Standards Act, 2000,          │    │
│  │  s. 57-58, Ms. Smith is entitled to a minimum       │    │
│  │  of 8 weeks' notice... ✓                            │    │
│  │                                                     │    │
│  │  [Source indicators inline]                         │    │
│  │  ✓ = verified (statute or case database)            │    │
│  │  ⚠ = web source (verify before use)                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  [Download DOCX] [Download PDF] [Save to Matter]            │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Automatic Status Monitoring

### How it works (zero manual input from lawyer)

Starling infers matter status from activity. The lawyer never updates a status field.

| Activity detected | Status set automatically | Icon |
|-------------------|------------------------|------|
| Matter created, documents uploading | "Intake received" | ● |
| Intake analysis complete | "Issues identified — ready to draft" | ● |
| Demand letter generated | "Demand letter drafted — pending review" | ● |
| SOC generated | "SOC drafted — pending review" | ● |
| No activity for 7+ days | "⚠ Stale — no activity in X days" | ⚠️ |
| No activity for 14+ days | "⚠ Dormant — no activity in X days" | ⚠️ |
| Limitation period within 30 days | "🔴 Urgent — limitation expires [date]" | 🔴 |
| Limitation period within 7 days | "🔴 CRITICAL — limitation expires [date]" | 🔴 |
| All documents generated + reviewed | "Complete" | ✅ |
| Lawyer marks as closed | "Closed" | ✅ |

### Additional status signals (from uploaded documents)

When the lawyer uploads documents during intake, Starling extracts dates:
- **Termination date** → calculates 2-year limitation automatically
- **Severance offer deadline** → flags if approaching
- **HRTO limitation** → 1 year from termination, flagged separately

These deadlines are tracked automatically — the lawyer doesn't enter them manually if they're in the uploaded documents.

### What triggers a stale/dormant flag

| Condition | Flag | How it's resolved |
|-----------|------|-------------------|
| 7 days since last session on this matter | ⚠ Stale | Any new activity clears it |
| 14+ days since last session | ⚠ Dormant | Any new activity clears it |
| Intake complete but no documents drafted | "Ready to draft — waiting on lawyer" | Lawyer drafts a document |
| Documents drafted but not exported/downloaded | "Draft ready — not yet sent" | Lawyer downloads or exports |

---

## 6. Weekly Digest Email

Every Monday at 9:00 AM, Starling sends the lawyer an email summary.

```
Subject: Starling Weekly — 3 matters need attention

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DemandPay Starling — Weekly Case Status
Week of June 23, 2026

Active Matters: 8  |  Needing Attention: 3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 URGENT
  Patel v MegaCorp
  Limitation expires July 9, 2026 (14 days)
  Status: SOC not filed
  Action: File Statement of Claim immediately

⚠️ STALE (no activity 7+ days)
  Jones v BigCo — 12 days dormant
  Last activity: Intake analysis
  Missing: employment agreement, termination letter

  Williams v StartupCo — 8 days dormant
  Last activity: Demand letter drafted
  Next: Send to employer or request lawyer review

✅ ON TRACK
  Smith v Acme Corp — Demand letter drafted (3 days ago)
  Lee v TechFirm — SOC in progress (today)
  Chen v RetailCo — Intake received (2 days ago)
  [3 more matters on track...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Open Starling: http://localhost:5173
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Technical implementation:**
- Uses Lavern's existing notification system (`src/claw/notify.ts`)
- Email via webhook (Slack/email) or Telegram integration (already built)
- Runs as a scheduled task (cron or Clawern daemon heartbeat)
- Pulls from SQLite matters table + session archive timestamps
- No new infrastructure needed — just a new notification type

---

## 7. Components to Keep vs Replace vs Add

| Current Component | Action | Notes |
|-------------------|--------|-------|
| Landing page (QuickStart) | **Replace** | New matter-centric dashboard |
| Intake flow (client info form) | **Simplify** | New Matter screen — just name, employer, description, upload |
| Briefing (AI interview) | **Keep but rename** | Becomes part of "New Matter" flow |
| Strategy/Team selection | **Remove from default** | Auto-select based on task. Available in Settings. |
| Working view | **Redesign** | Process steps view (human-readable, not agent chat) |
| Delivery view | **Redesign** | Results view with source attribution tabs |
| My Cases | **Redesign** | Matter list with auto-status and urgency sorting |
| Agent Builder | **Keep, hide** | Settings → Advanced → Custom Agents |
| Clawern dashboard | **Repurpose** | Powers the status monitoring backend (not UI) |
| Challenge view | **Remove** | Marketing feature |
| Demo tour | **Remove** | Replace with onboarding |
| **NEW: Matter Detail View** | **Build** | Core work screen per matter |
| **NEW: Weekly Digest** | **Build** | Automatic email summary |
| **NEW: Status Monitor** | **Build** | Auto-infer status from activity |

---

## 8. Branding

| Element | Specification |
|---------|--------------|
| Logo | DemandPay logo (three coloured dots + DEMAND PAY) |
| Primary | Navy #0f1a2e |
| Accent | Orange #ea580c |
| Background | Cream #faf8f5 |
| Frame | Warm gray #e8e5e0 |
| Borders | Sharp corners (radius 0), rgba(15,26,46,0.12) |
| Buttons | 2px radius only, orange primary CTA |
| Headings | Georgia, Palatino Linotype, serif |
| Body | system-ui, -apple-system, sans-serif |
| Success | Green #16a34a |
| Warning | Amber #d97706 |
| Danger | Red #dc2626 |
| Status: urgent | 🔴 Red accent, top of list |
| Status: stale | ⚠️ Amber accent |
| Status: active | ● Navy dot |
| Status: complete | ✅ Green |

---

## 9. Implementation Phases

### Phase 1: Mockups (Claude Cowork)
- Design mockups for: Dashboard, New Matter, Matter Detail, Processing, Results
- Use DemandPay brand colours and the wireframes above
- Get lawyer feedback on clarity and workflow

### Phase 2: Dashboard + Matter List
- Replace LandingView with new dashboard
- Build matter list with auto-status inference
- Wire 3 quick action cards to existing routing
- Urgency sorting (red → amber → navy → green)

### Phase 3: New Matter + Matter Detail
- Build New Matter screen (simplified intake)
- Build Matter Detail view with tabs (Issues, Docs, Draft, Timeline, Notes)
- Context-sensitive action buttons

### Phase 4: Processing + Results redesign
- Redesign WorkingView as process steps
- Redesign DeliveryView with source attribution tabs
- Add DOCX/PDF export

### Phase 5: Status Monitor + Weekly Digest
- Build status inference engine (activity timestamps → status)
- Build limitation period tracking (extract from documents)
- Build weekly digest email using existing notification system
- Configure scheduled send (Monday 9 AM)

### Phase 6: Document Management Integration (future)
- SharePoint connector for pilot firm
- Two-way sync: documents in → generated docs out
- Other DMS connectors (iManage, Clio, Google Drive) as needed

---

## 10. What NOT to Change

The UI is a presentation layer. These backend systems are already configured and must not be modified during the UI overhaul:

- Agent prompts (17 B2B agents, all rewritten for Ontario employment law)
- Router logic (7 employment law routing rules)
- Verification pipeline (8 passes with weighted scoring)
- Debate board and MCP tools
- Model tier assignments (5 Opus, 20 Sonnet)
- Web search allowlist
- Institutional memory and precedent board
- API server and WebSocket event streaming
- Session management and state persistence

---

## 11. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking agent pipeline during UI changes | Backend untouched. UI is presentation only. |
| Losing features during redesign | Removed components stay in codebase, just hidden from nav. |
| Scope creep | Phase 1 (mockups) gates everything. No code without approved mockups. |
| Status monitor false positives | Start with simple rules (days since activity). Refine based on lawyer feedback. |
| Weekly digest email deliverability | Use existing webhook notification (Slack/email). Add Resend integration later if needed. |
