/**
 * Employment Intake Types — Structured data model for Ontario employment law matters.
 *
 * This schema captures the same 40+ fields from the DemandPay B2C intake,
 * adapted for the Starling B2B lawyer-facing workflow. A lawyer enters data
 * on behalf of their client (structured form or AI extraction from documents).
 *
 * The intake feeds into:
 *   - Timeline generation (chronological event sequence)
 *   - Legal issue identification (16-gate system: G1–G16)
 *   - Demand letter assembly
 *   - Statement of Claim / Notice of Application drafting
 *
 * All dates are ISO 8601 (YYYY-MM-DD). All amounts are in CAD.
 */

import { z } from 'zod';

// ── Reusable primitives ──────────────────────────────────────────────────

const optString = z.string().trim().max(2000).optional().or(z.literal(''));
const optDate = z.string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Invalid date format (YYYY-MM-DD)')
  .optional()
  .or(z.literal(''));
const optBool = z.boolean().optional().nullable();
const optNumber = z.number().nonnegative().max(99_999_999).optional().nullable();

// ── Enums ────────────────────────────────────────────────────────────────

/** Ontario Human Rights Code — protected grounds (s. 5). */
export const DISCRIMINATION_GROUNDS = [
  'age', 'ancestry_race', 'creed_origin', 'disability', 'family_status',
  'gender_identity', 'marital_status', 'record_of_offences', 'sex',
  'sexual_orientation', 'other',
] as const;

/** Constructive dismissal grounds (Potter v New Brunswick). */
export const CONSTRUCTIVE_DISMISSAL_GROUNDS = [
  'cd_harassment', 'cd_reprisal', 'cd_discrimination', 'cd_humiliation',
  'cd_duties', 'cd_pay', 'cd_hours', 'cd_toxic',
] as const;

/** Bad faith conduct in manner of dismissal (Honda v Keays). */
export const BAD_FAITH_CONDUCT = [
  'bf_false_cause', 'bf_withheld_wages', 'bf_reputation',
  'bf_filed_claim', 'bf_refused_record', 'bf_other',
] as const;

export const SALARY_PERIODS = ['year', 'month', 'hour'] as const;
export const BONUS_TYPES = ['performance', 'discretionary', 'unsure'] as const;
export const EQUITY_TYPES = ['stock_options', 'rsus', 'equity'] as const;
export const PENSION_CONTRIBUTION_TYPES = ['percentage', 'fixed', 'unsure'] as const;
export const SEVERANCE_PAYMENT_TYPES = ['lump_sum', 'salary_continuation', 'unsure'] as const;

/** Document types a lawyer can upload for AI extraction. */
export const UPLOADABLE_DOCUMENT_TYPES = [
  'employment_agreement',
  'termination_letter',
  'roe',
  't4',
  'pay_stub',
  'correspondence',
  'performance_review',
  'policy_document',
  'collective_agreement',
  'other',
] as const;

/** Procedure types for Statement of Claim. */
export const PROCEDURE_TYPES = ['small_claims', 'simplified', 'ordinary'] as const;

/** Document types Starling can generate. */
export const GENERATABLE_DOCUMENT_TYPES = [
  'demand_letter',
  'statement_of_claim',
  'notice_of_application',
  'hrto_application',
  'esa_complaint',
] as const;

/** Demand letter tone options. */
export const TONE_OPTIONS = ['professional', 'firm', 'aggressive'] as const;

// ── Employment Intake Schema ─────────────────────────────────────────────

export const employmentIntakeSchema = z.object({
  // ── Client biographical ────────────────────────────────────────────────
  client_first_name:      optString,
  client_last_name:       optString,
  client_date_of_birth:   optDate,
  client_age:             z.number().int().min(14).max(120).optional().nullable(),
  client_email:           z.string().email().max(254).optional().or(z.literal('')),
  client_phone:           optString,
  client_address:         optString,
  client_city:            optString,
  client_province:        z.string().max(50).optional().or(z.literal('')),
  client_postal_code:     optString,
  /**
   * How documents refer to the client. Set by the lawyer, never inferred
   * from the name, and deliberately NOT read from gender_identity: that
   * field exists as a protected ground for a human rights claim and must
   * not do double duty as a drafting preference.
   *
   * "name" means the documents use the client's name and "our client"
   * throughout and no pronouns at all, which is how much correspondence is
   * already written.
   */
  client_pronouns: z.enum(['she', 'he', 'they', 'name']).optional().nullable(),

  // ── Employer information ───────────────────────────────────────────────
  employer_legal_name:    optString,
  employer_operating_name: optString,
  employer_address:       optString,
  employer_industry:      optString,
  is_unionized:           optBool,
  is_federal_employee:    optBool,
  work_province:          z.string().max(50).optional().or(z.literal('Ontario')),

  // ── Employment details ─────────────────────────────────────────────────
  hire_date:              optDate,
  contract_signed_date:   optDate,
  first_day_of_work:      optDate,
  job_title:              optString,
  key_duties:             z.string().trim().max(5000).optional().or(z.literal('')),
  role_changed_since_signing: optBool,
  role_change_details:    optString,

  // ── Compensation ───────────────────────────────────────────────────────
  annual_salary:          optNumber,
  salary_period:          z.enum(SALARY_PERIODS).optional().nullable(),
  hours_per_week:         optNumber,

  has_bonus:              optBool,
  bonus_amount:           optNumber,
  bonus_type:             z.enum(BONUS_TYPES).optional().nullable(),
  has_written_bonus_plan: optBool,

  has_commissions:        optBool,
  commission_amount:      optNumber,
  commission_structure:   optString,
  has_written_commission_plan: optBool,

  has_equity:             optBool,
  equity_types:           z.array(z.enum(EQUITY_TYPES)).max(3).optional().nullable(),
  equity_value:           optNumber,
  has_equity_agreement:   optBool,

  has_pension:            optBool,
  pension_contribution_type: z.enum(PENSION_CONTRIBUTION_TYPES).optional().nullable(),
  pension_percentage:     z.number().nonnegative().max(100).optional().nullable(),
  pension_amount:         optNumber,

  has_health_benefits:    optBool,
  health_benefits_monthly: optNumber,

  has_allowances:         optBool,
  allowances_details:     optString,
  allowances_amount:      optNumber,

  // ── Termination ────────────────────────────────────────────────────────
  was_terminated:         optBool,
  resigned:               optBool,
  termination_date:       optDate,
  last_day_worked:        optDate,
  termination_reasons_provided: optBool,
  termination_reasons:    optString,

  // ── Termination clause ─────────────────────────────────────────────────
  termination_clause_exists: optBool,
  termination_clause_text: z.string().trim().max(10000).optional().or(z.literal('')),
  termination_notice_period: optString,
  clause_signed_date:     optDate,
  clause_added_mid_employment: optBool,
  fresh_consideration_provided: optBool,

  // ── Just cause ─────────────────────────────────────────────────────────
  employer_alleged_just_cause: optBool,
  cause_allegations:      optString,

  // ── Constructive dismissal ─────────────────────────────────────────────
  is_constructive_dismissal: optBool,
  constructive_dismissal_grounds: z.array(
    z.enum(CONSTRUCTIVE_DISMISSAL_GROUNDS),
  ).max(8).optional().nullable(),
  constructive_dismissal_details: optString,

  // ── Discrimination / Human Rights ──────────────────────────────────────
  believes_discriminatory_termination: optBool,
  discrimination_grounds: z.array(
    z.enum(DISCRIMINATION_GROUNDS),
  ).max(11).optional().nullable(),
  discrimination_details: optString,
  has_known_medical_condition: optBool,
  was_on_medical_leave:   optBool,
  accommodation_requested: optBool,
  accommodation_denied:   optBool,
  accommodation_details:  optString,

  // ── Harassment ─────────────────────────────────────────────────────────
  experienced_harassment: optBool,
  harassment_details:     optString,

  // ── Reprisal ───────────────────────────────────────────────────────────
  experienced_reprisal:   optBool,
  reprisal_details:       optString,
  reprisal_type:          z.enum(['esa', 'ohsa', 'human_rights', 'other']).optional().nullable(),

  // ── Bad faith / punitive ───────────────────────────────────────────────
  bad_faith_conduct:      z.array(z.enum(BAD_FAITH_CONDUCT)).max(6).optional().nullable(),
  bad_faith_details:      optString,
  humiliating_termination: optBool,
  humiliating_termination_details: optString,

  // ── Inducement / prior employment ──────────────────────────────────────
  left_secure_employment: optBool,
  prior_employer_name:    optString,
  prior_employer_tenure:  optString,
  inducement_details:     optString,

  // ── Successor employer ─────────────────────────────────────────────────
  employer_changed_through_acquisition: optBool,
  predecessor_employer_name: optString,
  acquisition_date:       optDate,

  // ── Restrictive covenants ──────────────────────────────────────────────
  has_non_compete:        optBool,
  non_compete_text:       z.string().trim().max(10000).optional().or(z.literal('')),
  has_non_solicitation:   optBool,
  non_solicitation_text:  z.string().trim().max(10000).optional().or(z.literal('')),

  // ── Severance offer ────────────────────────────────────────────────────
  received_severance_offer: optBool,
  severance_deadline:     optDate,
  severance_weeks_offered: optNumber,
  severance_payment_type: z.enum(SEVERANCE_PAYMENT_TYPES).optional().nullable(),
  severance_offer_details: optString,
  signed_release:         optBool,

  // ── ROE ────────────────────────────────────────────────────────────────
  roe_issued:             optBool,
  roe_reason_code:        optString,
  roe_wrong_or_missing:   optBool,

  // ── Current status ─────────────────────────────────────────────────────
  currently_employed:     optBool,
  started_job_search:     optBool,
  job_search_efforts:     optString,
  new_employment_found:   optBool,
  new_employment_start_date: optDate,
  new_employment_salary:  optNumber,

  // ── Pleading fields (DemandPay schema names) ───────────────────────────
  // These answer the SOC node triggers, and their names follow the
  // DemandPay intake schema exactly so the two products read one another.
  // Booleans left unset mean "never asked": the cause cannot fire and the
  // node picker says why, which is different from an answered NO.

  // The contract, beyond the clause text already captured above.
  has_written_contract:   optBool,
  contract_date:          optDate,
  clause_cause_broader:   optBool,
  clause_no_benefits:     optBool,
  clause_limits_below_esa: optBool,
  employer_breached_clause: optBool,

  // Cause as alleged.
  false_cause_alleged:    optBool,

  // Inducement and misrepresentation.
  employer_initiated_recruitment: optBool,
  had_prior_secure_employment: optBool,
  recruiter_name_and_title: optString,
  inducement_representations: optString,
  promises_not_fulfilled: optBool,
  promises_known_false:   optBool,

  // Common employer.
  common_employer:        optBool,
  common_employer_documentation: optString,
  shared_management:      optBool,
  shared_payroll:         optBool,
  shared_branding:        optBool,

  // Defamation.
  defamatory_statements:  optBool,
  defamation_recipients:  optString,
  defamation_malicious:   optBool,

  // Privacy and mental suffering.
  privacy_breach:         optBool,
  privacy_breach_description: optString,
  iims:                   optBool,
  iims_conduct_description: optString,
  iims_illness_description: optString,
  mental_distress_symptoms: optString,

  // Unjust enrichment and breach of contract.
  unjust_enrichment:      optBool,
  unjust_enrichment_benefit: optString,
  breach_express_term:    optBool,
  express_term_description: optString,
  express_term_obligation: optString,
  breach_implied_term:    optBool,
  implied_term_conduct:   optString,

  // Covenants, beyond presence and text.
  noncompete_post_oct2021: optBool,
  covenant_enforcement_threat: optBool,
  is_executive_noncompete: optBool,
  noncompete_common_law:  optBool,

  // Successor employer and constructive dismissal framing.
  prior_related_employer: optBool,
  cd_cumulative:          optBool,
  cd_remote:              optBool,

  // Compensation particulars the relief block conditions on.
  has_benefits:           optBool,
  has_rrsp:               optBool,
  has_car_allowance:      optBool,
  unpaid_commission:      optBool,
  unpaid_overtime:        optBool,
  vacation_unpaid:        optBool,
  unauthorized_deductions: optBool,
  other_compensation_details: optString,
  benefits_not_continued: optBool,
  esa_shortfall:          optBool,
  esa_term_shortfall:     optBool,
  esa_sev_shortfall:      optBool,

  // Human rights particulars.
  hrc_protected_ground:   optString,
  hrc_complaint_made:     optBool,
  hrc_conduct_description: optString,
  sexual_harassment:      optBool,

  // Employment history colour.
  positive_performance:   optBool,
  workplace_location:     optString,
  job_duties:             optString,

  // ── Additional context ─────────────────────────────────────────────────
  additional_information: z.string().trim().max(10000).optional().or(z.literal('')),
  lawyer_notes:           z.string().trim().max(10000).optional().or(z.literal('')),
});

export type EmploymentIntakeData = z.infer<typeof employmentIntakeSchema>;

// ── Timeline Event ───────────────────────────────────────────────────────

export interface TimelineEvent {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Short label for the event. */
  label: string;
  /** Longer description (optional). */
  description?: string;
  /** Category for visual grouping. */
  category: 'employment' | 'termination' | 'legal' | 'mitigation' | 'other';
  /** Source: how this event was captured. */
  source: 'intake_form' | 'document_extraction' | 'lawyer_entry' | 'system';
  /**
   * True when this is a court-imposed or statutory deadline the lawyer must
   * not miss (drives the red "Critical" band on the docket). Set explicitly
   * by the lawyer on the add-event form; system litigation ticklers are
   * classified by their label. See deadlines.ts isCourtDeadline().
   */
  courtDeadline?: boolean;
}

// ── Gate Result ──────────────────────────────────────────────────────────

export interface GateResult {
  /** Gate identifier (G1–G16). */
  gate: string;
  /** Whether this gate is triggered. */
  triggered: boolean;
  /** Human-readable reason for triggering. */
  reason: string;
  /** Issue codes associated with this gate. */
  issueCodes: string[];
  /** Whether this gate's output requires lawyer review. */
  requiresLawyerReview: boolean;
}

// ── Intake Analysis Result ───────────────────────────────────────────────

export interface IntakeAnalysisResult {
  /** Chronological timeline of events. */
  timeline: TimelineEvent[];
  /** Which legal gates are triggered and why. */
  gates: GateResult[];
  /** Estimated damages breakdown. */
  damagesEstimate: {
    esaNoticeWeeks: number;
    esaNoticePay: number;
    esaSeverancePay: number;
    commonLawLowMonths: number;
    commonLawHighMonths: number;
    commonLawLowAmount: number;
    commonLawHighAmount: number;
    additionalHeads: Array<{ name: string; basis: string; estimatedAmount?: number }>;
    totalEstimateLow: number;
    totalEstimateHigh: number;
  };
  /** Bardal factor analysis. */
  bardalFactors: {
    age: number | null;
    tenureYears: number | null;
    character: string;
    availability: string;
  };
  /** Limitation period deadline. */
  limitationDeadline: {
    date: string;
    daysRemaining: number;
    urgent: boolean;
  };
  /** Recommended procedure type based on estimated damages. */
  recommendedProcedure: 'small_claims' | 'simplified' | 'ordinary';
}

// ── Document Extraction Result ───────────────────────────────────────────

export interface DocumentExtractionResult {
  /** Stable id for the apply loop. Older stored extractions may lack it. */
  id?: string;
  /** Type of document that was analysed. */
  documentType: typeof UPLOADABLE_DOCUMENT_TYPES[number];
  /** Filename. */
  filename: string;
  /** Fields extracted by Claude. Each field has a value and confidence. */
  extractedFields: Record<string, {
    value: string | number | boolean | null;
    confidence: 'high' | 'medium' | 'low';
    /** Verbatim source sentence (quote grounding); absent on old extractions. */
    sourceQuote?: string;
    /** True when the sourceQuote was found verbatim in the document. */
    verified?: boolean;
  }>;
  /**
   * Settlement offers detected in the document, PROPOSED for the
   * negotiation ledger. Nothing reaches the ledger until the lawyer
   * approves each one in the review panel (same gate as the fields).
   */
  offers?: Array<{
    /** YYYY-MM-DD when stated in the document; null when the lawyer must supply it. */
    date: string | null;
    party: 'employer' | 'client';
    kind: 'offer' | 'counter' | 'demand' | 'acceptance' | 'rejection';
    amountCad: number | null;
    terms: string | null;
    sourceQuote?: string;
    verified?: boolean;
  }>;
  /** Key findings / notable clauses / red flags. */
  keyFindings: string[];
  /** Whether the lawyer has confirmed the extraction. */
  confirmed: boolean;
  /** Set when the lawyer applied fields to the intake. */
  appliedAt?: string;
  /** The intake fields that were applied. */
  appliedFields?: string[];
  /** LLM cost of the extraction call (metered to the usage ledger). */
  costUsd?: number;
}

// ── Source Citation ──────────────────────────────────────────────────────
// Tracks which uploaded document text the AI relied on for each section
// of a generated document. Lets the lawyer click through to verify.

export interface SourceCitation {
  /** Which section of the generated document this citation supports. */
  section: string;
  /** Name of the source document (e.g. "Employment Agreement.pdf"). */
  documentName: string;
  /** Verbatim quoted text from the source document. */
  quotedText: string;
  /** Where in the document this text appears (page, section, paragraph). */
  location?: string;
  /** How the cited text is used (e.g. "termination clause analysis", "salary verification"). */
  purpose: string;
  /** Confidence that this citation is accurate. */
  confidence: 'high' | 'medium' | 'low';
}

// ── Employment Matter Extension ──────────────────────────────────────────
// These fields extend the base MatterRecord for employment matters.

export interface EmploymentMatterData {
  /** The structured intake data (from form or AI extraction). */
  intake: EmploymentIntakeData;
  /**
   * When the intake facts last changed (manual save, portal apply, or
   * extraction apply). Drafts generated before this are stale.
   */
  intakeRevisedAt?: string;
  /** Timeline of events (grows over the matter lifecycle). */
  timeline: TimelineEvent[];
  /** Legal gate evaluation results. */
  gates: GateResult[];
  /** Which legal issues the lawyer has approved for inclusion in documents. */
  approvedIssues: string[];
  /** Which legal issues the lawyer has dismissed. */
  dismissedIssues: string[];
  /** Document extraction results (one per uploaded document). */
  documentExtractions: DocumentExtractionResult[];
  /** Full intake analysis (damages, Bardal, limitations, procedure). */
  analysis: IntakeAnalysisResult | null;
  /** When the analysis was last computed. Compared against intakeRevisedAt so stale figures never feed a document silently. */
  analysisRevisedAt?: string;
  /** Lawyer's chosen tone for demand letter. */
  selectedTone: typeof TONE_OPTIONS[number];
  /** Lawyer's chosen procedure type (may override recommendation). */
  selectedProcedure: typeof PROCEDURE_TYPES[number] | null;
  /** Lawyer's chosen document type to generate. */
  selectedDocumentType: typeof GENERATABLE_DOCUMENT_TYPES[number] | null;
  /** Demand amount set by the lawyer (system suggests a range). */
  demandAmount: number | null;
}

/**
 * Create a new EmploymentMatterData with defaults.
 */
export function createEmploymentMatterData(): EmploymentMatterData {
  return {
    intake: {} as EmploymentIntakeData,
    timeline: [],
    gates: [],
    approvedIssues: [],
    dismissedIssues: [],
    documentExtractions: [],
    analysis: null,
    selectedTone: 'professional',
    selectedProcedure: null,
    selectedDocumentType: null,
    demandAmount: null,
  };
}
