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
      if (typeof it.task === 'string') it.task = it.task.slice(0, 500);
      if (typeof it.context === 'string') it.context = it.context.slice(0, 1200);
      if (typeof it.emailSubject === 'string') it.emailSubject = it.emailSubject.slice(0, 300);
      if (typeof it.emailBody === 'string') it.emailBody = it.emailBody.slice(0, 4000);
      // A malformed date is dropped, never guessed at.
      if (typeof it.dueDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) it.dueDate = null;
      return it;
    });
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
