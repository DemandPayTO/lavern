/**
 * Labour (Union-Side) Intake — grievance matters for union-side firms
 * and unions themselves.
 *
 * The matter unit is the GRIEVANCE, not an individual retainer. The
 * critical structural difference from employment intake: deadlines come
 * from the COLLECTIVE AGREEMENT's grievance procedure, not statute —
 * so the intake captures the CA's step time limits explicitly and the
 * analysis computes the docket from them.
 *
 * Ontario context: non-lawyer union representatives lawfully represent
 * at grievance arbitration, so the user may be a labour relations
 * officer rather than counsel. Review-gate language says "reviewer",
 * not "lawyer", where it matters.
 */

import { z } from 'zod';

// ── Enums ────────────────────────────────────────────────────────────────

export const GRIEVANCE_TYPES = [
  'discharge',           // termination of the grievor
  'discipline',          // suspension, written warning, demotion
  'policy',              // union challenges an employer rule/policy (KVP)
  'interpretation',      // CA interpretation / application dispute
  'group',               // group grievance
  'human_rights',        // discrimination/accommodation under the Code
  'health_safety',       // OHSA-related, incl. reprisal
  'other',
] as const;

export const DISCIPLINE_IMPOSED = [
  'verbal_warning', 'written_warning', 'suspension_unpaid', 'suspension_paid',
  'demotion', 'transfer', 'discharge', 'last_chance_agreement', 'other', 'none',
] as const;

export const DAY_KIND = ['calendar', 'working'] as const;

export const WAGE_RATE_PERIODS = ['hour', 'week', 'year'] as const;

// ── Schema ───────────────────────────────────────────────────────────────

const optString = z.string().trim().max(2000).optional().or(z.literal(''));
const optDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional().or(z.literal(''));
const optBool = z.boolean().optional().nullable();
const optNumber = z.number().nonnegative().optional().nullable();

/**
 * One step of the CA's grievance procedure. Two clocks attach to a step:
 * the employer's time to answer, and the union's time to advance to the
 * next step after the answer (or after the answer was due).
 */
export const caProcedureStepSchema = z.object({
  label: z.string().trim().min(1).max(60),
  /** Days the employer has to respond once the grievance is presented at this step. */
  employer_response_days: z.number().positive().max(365).optional().nullable(),
  /** Days the union has to advance to the NEXT step after the employer's response. */
  advance_days: z.number().positive().max(365).optional().nullable(),
  day_kind: z.enum(DAY_KIND).optional().nullable(),
});
export type CaProcedureStep = z.infer<typeof caProcedureStepSchema>;

/** A recorded event in the procedure: presentation and response at a step. */
export const stepEventSchema = z.object({
  step_label: z.string().trim().min(1).max(60),
  presented_date: optDate,
  response_date: optDate,
});
export type GrievanceStepEvent = z.infer<typeof stepEventSchema>;

export const grievanceIntakeSchema = z.object({
  // ── Grievor ────────────────────────────────────────────────────────────
  grievor_first_name: optString,
  grievor_last_name: optString,
  grievor_employee_id: optString,
  grievor_classification: optString,     // job classification / position
  grievor_seniority_date: optDate,
  grievor_department: optString,
  grievor_contact: optString,

  // ── Union ──────────────────────────────────────────────────────────────
  union_name: optString,                 // e.g. "USW Local 1998"
  union_local: optString,
  union_rep_name: optString,             // steward / LRO handling the file

  // ── Employer ───────────────────────────────────────────────────────────
  employer_name: optString,
  employer_contact: optString,           // LR/HR contact for the grievance
  workplace_location: optString,

  // ── Collective agreement ───────────────────────────────────────────────
  ca_title: optString,                   // e.g. "2024–2027 Collective Agreement"
  ca_expiry_date: optDate,
  grievance_procedure_article: optString, // e.g. "Article 8"
  just_cause_article: optString,          // e.g. "Article 7.01"
  /** Days to FILE the grievance after the incident (or knowledge of it). */
  filing_deadline_days: optNumber,
  filing_deadline_kind: z.enum(DAY_KIND).optional().nullable(),
  /** Days to refer to arbitration after the final step response. */
  referral_deadline_days: optNumber,
  referral_deadline_kind: z.enum(DAY_KIND).optional().nullable(),
  /** Whether the CA says time limits are mandatory vs directory. */
  time_limits_mandatory: optBool,
  ca_notes: optString,
  /** CA library profile this matter's CA terms were copied from (snapshot at intake). */
  ca_profile_id: optString,
  /** The CA's grievance procedure steps, in order. Drives the step clocks. */
  procedure_steps: z.array(caProcedureStepSchema).max(10).optional().nullable(),
  /** Recorded presentations and responses at each step. Drives the step clocks. */
  step_events: z.array(stepEventSchema).max(20).optional().nullable(),

  // ── The incident / grievance ───────────────────────────────────────────
  grievance_type: z.enum(GRIEVANCE_TYPES).optional().nullable(),
  incident_date: optDate,
  /** When the union/grievor first learned of the incident (starts many clocks). */
  knowledge_date: optDate,
  incident_description: optString,
  discipline_imposed: z.enum(DISCIPLINE_IMPOSED).optional().nullable(),
  discipline_letter_date: optDate,
  employer_stated_grounds: optString,

  // ── Grievance procedure history ────────────────────────────────────────
  grievance_filed: optBool,
  grievance_filed_date: optDate,
  grievance_number: optString,
  current_step: optString,               // e.g. "Step 2"
  last_step_response_date: optDate,      // starts the referral clock
  step_extensions_agreed: optBool,
  step_extension_details: optString,

  // ── Prior record & procedure ───────────────────────────────────────────
  prior_discipline: optBool,
  prior_discipline_details: optString,
  /** Sunset clause: months after which prior discipline is expunged. */
  sunset_clause_months: optNumber,
  union_rep_present_at_meeting: optBool,
  investigation_conducted: optBool,
  investigation_details: optString,

  // ── Human rights / statutory overlays ─────────────────────────────────
  believes_discriminatory: optBool,
  discrimination_grounds: z.array(z.string().max(50)).max(11).optional().nullable(),
  accommodation_involved: optBool,
  accommodation_details: optString,
  ohsa_reprisal_alleged: optBool,
  reprisal_details: optString,

  // ── Off-duty conduct ───────────────────────────────────────────────────
  off_duty_conduct: optBool,
  off_duty_details: optString,

  // ── Remedy ─────────────────────────────────────────────────────────────
  remedy_sought: optString,              // reinstatement, make-whole, rescind policy...
  back_pay_estimate: optNumber,

  // ── Compensation (remedy worksheet inputs) ─────────────────────────────
  wage_rate: optNumber,
  wage_rate_period: z.enum(WAGE_RATE_PERIODS).optional().nullable(),
  hours_per_week: optNumber,
  /** Vacation pay percentage on gross back pay (e.g. 4 or 6). */
  vacation_pay_percent: optNumber,
  /** Value of benefits as a percentage of wages, per the CA or benefits booklet. */
  benefits_load_percent: optNumber,
  /** Employer pension contribution percentage of wages. */
  pension_contrib_percent: optNumber,
  /** Earnings from other employment during the back-pay period (mitigation set-off). */
  interim_earnings: optNumber,

  // ── DFR exposure (unions as clients) ───────────────────────────────────
  dfr_concern: optBool,
  dfr_details: optString,                // grievor threatening s.74 LRA complaint etc.
});

export type GrievanceIntakeData = z.infer<typeof grievanceIntakeSchema>;

// ── Gate result (mirrors the employment gate shape so UI reuse is free) ──

export interface LabourGateResult {
  gate: string;
  triggered: boolean;
  reason: string;
  issueCodes: string[];
  requiresLawyerReview: boolean;
}

// ── Matter-level container ───────────────────────────────────────────────

export interface LabourMatterData {
  intake: GrievanceIntakeData;
  gates: LabourGateResult[];
  approvedIssues: string[];
  dismissedIssues: string[];
  timeline: Array<{
    date: string;
    label: string;
    description?: string;
    category: 'incident' | 'grievance' | 'deadline' | 'other';
    source: 'intake_form' | 'document_extraction' | 'user_entry' | 'system';
  }>;
  analysis: Record<string, unknown> | null;
}

// ── CA library profile ───────────────────────────────────────────────────
// A bargaining unit has one collective agreement and many grievances.
// The profile is extracted or entered once and copied onto each new
// grievance at intake (a snapshot, so later profile edits do not silently
// change the docket on existing matters).

export const caProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  union_name: optString,
  employer_name: optString,
  ca_title: optString,
  ca_expiry_date: optDate,
  grievance_procedure_article: optString,
  just_cause_article: optString,
  filing_deadline_days: optNumber,
  filing_deadline_kind: z.enum(DAY_KIND).optional().nullable(),
  referral_deadline_days: optNumber,
  referral_deadline_kind: z.enum(DAY_KIND).optional().nullable(),
  time_limits_mandatory: optBool,
  sunset_clause_months: optNumber,
  procedure_steps: z.array(caProcedureStepSchema).max(10).optional().nullable(),
  ca_notes: optString,
});
export type CaProfileData = z.infer<typeof caProfileSchema>;

export function createLabourMatterData(): LabourMatterData {
  return {
    intake: {} as GrievanceIntakeData,
    gates: [],
    approvedIssues: [],
    dismissedIssues: [],
    timeline: [],
    analysis: null,
  };
}
