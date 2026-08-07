/**
 * Matter Debrief — turn raw call notes into a reviewed summary and a dated,
 * checkable action-item list.
 *
 * The LLM only PROPOSES: it reads the notes and returns a summary plus
 * candidate action items with owners, kinds, and dates it can find in the
 * text. It never invents a date. Everything the model returns is reviewed and
 * edited by the lawyer before anything is saved (the human gate). Once
 * approved, the downstream wiring is deterministic: dated items become docket
 * deadlines (and flow to the ICS feed + weekly digest), and email items carry
 * a draft the lawyer copies and sends manually. Starling never sends.
 *
 * See docs/specs/matter-debrief-2026-07.md.
 */

import { z } from 'zod';

export type ActionItemOwner = 'lawyer' | 'client' | 'other';
export type ActionItemKind = 'task' | 'email' | 'call' | 'filing' | 'document';
export type ActionItemStatus = 'open' | 'done';

export interface ActionItem {
  id: string;
  task: string;
  owner: ActionItemOwner;
  /** ISO date (YYYY-MM-DD) or null when the notes state no date. */
  dueDate: string | null;
  kind: ActionItemKind;
  context: string;
  status: ActionItemStatus;
  /** Present for email-kind items: a draft the lawyer reviews and sends. */
  emailSubject?: string;
  emailBody?: string;
}

export interface DebriefEntry {
  id: string;
  createdAt: string;
  callType: 'client' | 'opposing' | 'internal' | 'other';
  summary: string;
  actionItems: ActionItem[];
}

// ── LLM analysis (proposal only, never persisted directly) ────────────────

export const debriefAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  actionItems: z.array(
    z.object({
      task: z.string().trim().min(1).max(500),
      owner: z.enum(['lawyer', 'client', 'other']).default('lawyer'),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      kind: z.enum(['task', 'email', 'call', 'filing', 'document']).default('task'),
      context: z.string().trim().max(1200).default(''),
      emailSubject: z.string().trim().max(300).optional(),
      emailBody: z.string().trim().max(4000).optional(),
    }),
  ).max(40).default([]),
  /**
   * Drafting instructions heard on the call, offered to the Direction
   * system. Matter-level by default at the lawyer's decision; the scope is
   * editable at approval. Proposals only: nothing binds unchecked.
   */
  proposedDirection: z.array(
    z.object({
      text: z.string().trim().min(1).max(600),
      kind: z.enum(['scope', 'include', 'exclude', 'figures', 'tone', 'process']).catch('scope'),
    }),
  ).max(10).default([]),
  /**
   * Intake facts the call supports, for the narrative causes documents
   * cannot prove. Same evidence discipline as document extraction: a
   * cause-trigger true without a quote that verifies against the notes is
   * discarded before the lawyer sees it.
   */
  /**
   * Dated case events heard on the call, offered to the matter timeline.
   * The chronology in a lawyer's notes is exactly what the claim's
   * Background Facts pleads, so it belongs on the record, not in a note.
   */
  proposedTimelineEvents: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      label: z.string().trim().min(1).max(200),
      description: z.string().trim().max(500).optional(),
    }),
  ).max(15).default([]),
  proposedIntakeFields: z.record(
    z.string(),
    z.object({
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      confidence: z.enum(['high', 'medium', 'low']).catch('medium'),
      sourceQuote: z.string().max(600).optional(),
    }),
  ).default({}),
});

export type DebriefAnalysis = z.infer<typeof debriefAnalysisSchema>;

/**
 * Trim an analysis to the schema's caps BEFORE validation.
 *
 * A long call produces a long summary and many items, and a model that
 * runs a few characters over a cap must lose the excess, not the whole
 * analysis. The same lesson as the style guide's 502: strict validation
 * on unclamped model output turns "slightly too long" into "failed".
 */
export function clampDebriefAnalysis(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const g = raw as Record<string, unknown>;
  if (typeof g.summary === 'string') g.summary = g.summary.slice(0, 4000);
  if (Array.isArray(g.actionItems)) {
    g.actionItems = g.actionItems.slice(0, 40).map(item => {
      if (!item || typeof item !== 'object') return item;
      const it = item as Record<string, unknown>;
      // A model writing every key emits null where the schema says
      // optional, and optional means undefined, not null. Normalise:
      // null on an optional or defaulted key becomes absence.
      for (const k of ['emailSubject', 'emailBody', 'owner', 'kind', 'context']) {
        if (it[k] === null) delete it[k];
      }
      if (typeof it.task === 'string') it.task = it.task.slice(0, 500);
      if (typeof it.context === 'string') it.context = it.context.slice(0, 1200);
      if (typeof it.emailSubject === 'string') it.emailSubject = it.emailSubject.slice(0, 300);
      if (typeof it.emailBody === 'string') it.emailBody = it.emailBody.slice(0, 4000);
      // A malformed date is dropped, never guessed at.
      if (typeof it.dueDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) it.dueDate = null;
      return it;
    });
  }
  if (Array.isArray(g.proposedTimelineEvents)) {
    g.proposedTimelineEvents = g.proposedTimelineEvents.slice(0, 15).map(e => {
      if (!e || typeof e !== 'object') return e;
      const ev = e as Record<string, unknown>;
      if (ev.description === null) delete ev.description;
      if (typeof ev.label === 'string') ev.label = ev.label.slice(0, 200);
      if (typeof ev.description === 'string') ev.description = ev.description.slice(0, 500);
      return ev;
    }).filter(e => {
      const ev = e as Record<string, unknown>;
      // An event without a well-formed date is not a timeline event; the
      // no-invented-dates rule holds by dropping it, never guessing.
      return typeof ev?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.date as string);
    });
  }
  if (Array.isArray(g.proposedDirection)) {
    g.proposedDirection = g.proposedDirection.slice(0, 10).map(d => {
      if (!d || typeof d !== 'object') return d;
      const it = d as Record<string, unknown>;
      if (typeof it.text === 'string') it.text = it.text.slice(0, 600);
      return it;
    });
  }
  if (g.proposedIntakeFields && typeof g.proposedIntakeFields === 'object') {
    const entries = Object.entries(g.proposedIntakeFields as Record<string, unknown>).slice(0, 30);
    g.proposedIntakeFields = Object.fromEntries(entries.map(([k, v]) => {
      if (v && typeof v === 'object') {
        const f = v as Record<string, unknown>;
        if (typeof f.sourceQuote === 'string') f.sourceQuote = f.sourceQuote.slice(0, 600);
      }
      return [k, v];
    }));
  }
  return raw;
}

export const DEBRIEF_SYSTEM_PROMPT = `You are an assistant to an Ontario employment lawyer. You are given the lawyer's own raw notes from a call about a legal matter. Your job is to organize those notes, not to give legal advice.

Return ONLY valid JSON matching this shape:
{
  "summary": "a concise plain-language summary of what was discussed and decided",
  "actionItems": [
    {
      "task": "short imperative description of one deliverable or follow-up",
      "owner": "lawyer" | "client" | "other",
      "dueDate": "YYYY-MM-DD" or null,
      "kind": "task" | "email" | "call" | "filing" | "document",
      "context": "the background from the notes explaining why this matters",
      "emailSubject": "only when kind is email",
      "emailBody": "only when kind is email: a short professional draft the lawyer will review before sending"
    }
  ]
}

Rules:
- Extract every distinct deliverable, follow-up, deadline, and commitment mentioned in the notes.
- dueDate: ONLY set a date the notes actually state or clearly imply (for example "by next Friday" relative to a stated call date). If the notes give no date, return null. NEVER invent a date.
- owner: who must do the task. Default to "lawyer".
- kind: "email" if the task is to write to someone; "call" for a phone call; "filing" for a court or tribunal filing; "document" for drafting a document; otherwise "task".
- For "email" items, draft a brief, professional emailSubject and emailBody. Use square-bracket markers like [LAWYER: confirm amount] wherever a detail must be filled or verified. Do not state legal conclusions as certainties.
- Be faithful to the notes. Do not add tasks, facts, or advice that are not in the notes.
- Canadian English. No em dashes.

Three further keys, all OPTIONAL and all proposals the lawyer approves separately:

"proposedTimelineEvents": dated CASE EVENTS from the notes, each {"date": "YYYY-MM-DD", "label": "short factual label", "description": "optional detail"}. These are things that HAPPENED in the case's history ("Told termination was restructuring", "Role reposted publicly"), not things to do: deliverables belong in actionItems. Only events whose date the notes state or clearly anchor. NEVER invent a date. Omit the key when there are none.

"proposedDirection": drafting instructions heard on the call, each {"text": "...", "kind": "scope"|"include"|"exclude"|"figures"|"tone"|"process"}. An instruction is something a drafter can follow and a reader can check ("Do not commit to a number on the next call with opposing counsel", "Demand only the unpaid notice period"). Write each in the imperative, one sentence. Where the notes mark something as the supervising partner's direction, keep that attribution in the text. A conditional ("if they come back under 50, then...") is not yet direction: leave it out. Extract only what the notes support. Omit the key when there is none.

"proposedIntakeFields": facts the call supports for the client file, as {"field_name": {"value": ..., "sourceQuote": "the exact sentence from the notes"}}. Only these fields:
- privacy_breach (boolean) [PLEADING], privacy_breach_description (string)
- iims (boolean) [PLEADING], iims_conduct_description (string), iims_illness_description (string), mental_distress_symptoms (string)
- defamatory_statements (boolean) [PLEADING], defamation_recipients (string)
- common_employer (boolean) [PLEADING], common_employer_documentation (string)
- unjust_enrichment (boolean) [PLEADING], unjust_enrichment_benefit (string)
- employer_initiated_recruitment (boolean) [PLEADING], had_prior_secure_employment (boolean) [PLEADING], prior_employer_name (string), prior_employer_tenure (string), inducement_representations (string)
- promises_not_fulfilled (boolean) [PLEADING]
- bad_faith_details (string), hrc_protected_ground (string), hrc_conduct_description (string)
- new_employment_found (boolean), new_employment_start_date (YYYY-MM-DD), new_employment_salary (number)
- signed_release (boolean)
[PLEADING] rules: set true ONLY where the notes explicitly support it and ALWAYS include sourceQuote with the exact sentence; a true without a quote is discarded. NEVER set a [PLEADING] field to false: notes not mentioning a thing is not evidence it did not happen; omit the field instead. Omit the key entirely when the call supports nothing.

- Return only the JSON object, no markdown fences, no commentary.`;

export function buildDebriefUserPrompt(rawNotes: string, callType: string, callDateIso: string): string {
  return `Call type: ${callType}
Call date: ${callDateIso}

Organize these notes into the JSON structure. Dates in the notes are relative to the call date above.

<notes>
${rawNotes}
</notes>`;
}

// ── Deterministic helpers ─────────────────────────────────────────────────

let counter = 0;
/** Stable-ish unique id for an action item (time + sequence + suffix). */
export function actionItemId(suffix = ''): string {
  counter += 1;
  return `ai-${Date.now()}-${counter}-${suffix || Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Normalize a reviewed analysis into stored ActionItems (assign ids, default
 * status open, drop email fields on non-email items).
 */
export function toStoredActionItems(items: DebriefAnalysis['actionItems']): ActionItem[] {
  return items.map((it) => {
    const base: ActionItem = {
      id: actionItemId(it.kind),
      task: it.task,
      owner: it.owner,
      dueDate: it.dueDate,
      kind: it.kind,
      context: it.context,
      status: 'open',
    };
    if (it.kind === 'email') {
      if (it.emailSubject) base.emailSubject = it.emailSubject;
      if (it.emailBody) base.emailBody = it.emailBody;
    }
    return base;
  });
}

/**
 * Open, dated action items across all debriefs on a matter, for the docket.
 * Pure: takes the debriefs array, returns {date, label} pairs.
 */
export function openDatedActionItems(debriefs: DebriefEntry[] | undefined): Array<{ date: string; label: string }> {
  const out: Array<{ date: string; label: string }> = [];
  for (const d of debriefs ?? []) {
    for (const it of d.actionItems ?? []) {
      if (it.status === 'open' && it.dueDate) {
        out.push({ date: it.dueDate, label: `Action: ${it.task}` });
      }
    }
  }
  return out;
}
