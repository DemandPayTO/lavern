/**
 * Firm Template System — Upload, manage, and inject content into firm-specific DOCX templates.
 *
 * Firms upload their own DOCX templates with placeholder markers like
 * {{CLIENT_NAME}}, {{FACTS_SECTION}}, {{LEGAL_ANALYSIS}}, etc.
 * When generating a document, Starling injects the AI-generated content
 * into the firm's template, preserving their formatting, fonts, logos,
 * headers, footers, and styles.
 *
 * Template storage:
 *   - Templates are stored per-firm in the SQLite database (firm_templates table)
 *   - Each template has a type (demand_letter, statement_of_claim, etc.)
 *   - A firm can have one template per document type
 *   - Default templates are provided for firms without custom ones
 *
 * Placeholder format:
 *   {{PLACEHOLDER_NAME}} — replaced with the corresponding content
 *   {{#SECTION_NAME}}...{{/SECTION_NAME}} — conditional blocks (included if the section has content)
 */

import { createLogger } from '../utils/logger.js';
import { z } from 'zod';

const logger = createLogger('FIRM-TEMPLATES');

// ── Types ────────────────────────────────────────────────────────────────

export type TemplateDocumentType =
  | 'demand_letter'
  | 'statement_of_claim'
  | 'notice_of_application'
  | 'hrto_application'
  | 'esa_complaint'
  | 'discovery_plan'
  | 'affidavit_of_documents'
  | 'mediation_brief'
  | 'severance_assessment'
  | 'counter_offer'
  | 'reply'
  | 'rule49_offer'
  | 'settlement_minutes'
  | 'retainer_agreement'
  | 'mitigation_log'
  | 'settlement_conference_brief'
  | 'hrto_schedule_a';

export interface FirmTemplate {
  /** Unique template ID. */
  id: string;
  /** Firm identifier (tenant isolation). */
  firmId: string;
  /** Document type this template is for. */
  documentType: TemplateDocumentType;
  /** Human-readable template name (e.g. "Standard Demand Letter"). */
  name: string;
  /** The raw DOCX template content as a base64-encoded string. */
  templateBase64: string;
  /** Detected placeholders in the template. */
  placeholders: string[];
  /** When the template was uploaded. */
  uploadedAt: string;
  /** When the template was last updated. */
  updatedAt: string;
}

export interface TemplatePlaceholderValues {
  [key: string]: string | undefined;
}

// ── Standard placeholders ────────────────────────────────────────────────
// These are the placeholders that Starling knows how to fill.

export const STANDARD_PLACEHOLDERS: Record<string, string> = {
  // Party information
  '{{CLIENT_NAME}}': 'Full legal name of the client (plaintiff/applicant)',
  '{{CLIENT_FIRST_NAME}}': 'Client first name',
  '{{CLIENT_LAST_NAME}}': 'Client last name',
  '{{CLIENT_ADDRESS}}': 'Client address',
  '{{EMPLOYER_NAME}}': 'Employer legal name',
  '{{EMPLOYER_ADDRESS}}': 'Employer address',

  // Firm information
  '{{FIRM_NAME}}': 'Law firm name',
  '{{LAWYER_NAME}}': 'Lawyer name',
  '{{FIRM_ADDRESS}}': 'Firm address',
  '{{DATE}}': 'Date of the document',
  '{{FILE_NUMBER}}': 'Matter/file number',

  // Court information
  '{{COURT_NAME}}': 'Court name and location',
  '{{COURT_FILE_NUMBER}}': 'Court file number (placeholder for filing)',

  // Employment particulars
  '{{JOB_TITLE}}': 'The client\u2019s position',
  '{{HIRE_DATE}}': 'Date the client was hired',
  '{{TERMINATION_DATE}}': 'Date of termination',
  '{{ANNUAL_SALARY}}': 'Annual salary at termination',
  '{{AMOUNT}}': 'The demand or settlement figure set on the matter',

  // Content sections
  '{{SALUTATION}}': 'Opening salutation (Dear...)',
  '{{EMPLOYMENT_BACKGROUND}}': 'Employment history narrative',
  '{{TERMINATION_FACTS}}': 'Termination narrative',
  '{{LEGAL_ANALYSIS}}': 'Full legal analysis (all approved issues)',
  '{{DAMAGES_SECTION}}': 'Damages quantification',
  '{{DEMAND}}': 'Demand amount and terms',
  '{{CLOSING}}': 'Closing paragraph and deadline',
  '{{SIGNATURE_BLOCK}}': 'Lawyer signature block',

  // SOC-specific
  '{{TITLE_OF_PROCEEDINGS}}': 'Title of proceedings (parties and court)',
  '{{CLAIM}}': 'The plaintiff claims: (prayer for relief)',
  '{{FACTS_SECTION}}': 'Numbered facts paragraphs',
  '{{LEGAL_BASIS}}': 'Legal basis for each claim',
  '{{DAMAGES_PARTICULARS}}': 'Itemised damages breakdown',
  '{{RELIEF_SOUGHT}}': 'Prayer for relief',
};

// ── Placeholder detection ────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;

/**
 * Detect all placeholders in a template string.
 * Returns an array of placeholder names (without the {{ }}).
 */
export function detectPlaceholders(templateText: string): string[] {
  const found = new Set<string>();
  let match;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(templateText)) !== null) {
    found.add(match[1]);
  }
  return [...found].sort();
}

// ── Placeholder injection ────────────────────────────────────────────────

/**
 * Inject values into a template string by replacing placeholders.
 *
 * @param template The template text with {{PLACEHOLDER}} markers.
 * @param values   A map of placeholder names to their values.
 * @returns        The template with all known placeholders replaced.
 */
export function injectPlaceholders(template: string, values: TemplatePlaceholderValues): string {
  let result = template;

  // Replace conditional sections: {{#SECTION_NAME}}...{{/SECTION_NAME}}
  // Include the block if the value is defined and non-empty, otherwise remove it.
  const conditionalRe = /\{\{#([A-Z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  result = result.replace(conditionalRe, (_match, name, content) => {
    const value = values[name];
    return value && value.trim() ? content.replace(`{{${name}}}`, value) : '';
  });

  // Replace simple placeholders
  result = result.replace(PLACEHOLDER_RE, (_match, name) => {
    return values[name] ?? `{{${name}}}`;  // Leave unreplaced if no value
  });

  return result;
}

/**
 * Build placeholder values from intake data and generated content.
 *
 * This maps the structured intake data + generated HTML sections into
 * the placeholder format that templates expect.
 */
/** ISO date to the long form Ontario correspondence uses. */
function formatDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatMoney(amount: number): string {
  return `$${amount.toLocaleString('en-CA')}`;
}

export function buildPlaceholderValues(args: {
  intake: {
    client_first_name?: string;
    client_last_name?: string;
    client_address?: string;
    employer_legal_name?: string;
    employer_address?: string;
    job_title?: string;
    hire_date?: string;
    termination_date?: string;
    annual_salary?: number | null;
  };
  /** Demand or settlement figure the lawyer set on the matter. */
  demandAmount?: number | null;
  firmName?: string;
  lawyerName?: string;
  firmAddress?: string;
  matterNumber?: string;
  courtName?: string;
  date?: string;
  /** Generated HTML content sections (from demand letter or SOC generator). */
  generatedHtml?: string;
}): TemplatePlaceholderValues {
  const date = args.date ?? new Date().toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return {
    CLIENT_NAME: [args.intake.client_first_name, args.intake.client_last_name]
      .filter(Boolean).join(' ') || undefined,
    CLIENT_FIRST_NAME: args.intake.client_first_name || undefined,
    CLIENT_LAST_NAME: args.intake.client_last_name || undefined,
    CLIENT_ADDRESS: args.intake.client_address || undefined,
    EMPLOYER_NAME: args.intake.employer_legal_name || undefined,
    EMPLOYER_ADDRESS: args.intake.employer_address || undefined,
    FIRM_NAME: args.firmName || undefined,
    LAWYER_NAME: args.lawyerName || undefined,
    FIRM_ADDRESS: args.firmAddress || undefined,
    DATE: date,
    FILE_NUMBER: args.matterNumber || undefined,
    COURT_NAME: args.courtName || undefined,
    COURT_FILE_NUMBER: '[TO BE ASSIGNED]',
    // Employment particulars. Precedent alignment proposes these markers
    // when it sees the job title, dates, or salary varying between a
    // firm's precedents, so they must be fillable or an aligned template
    // would carry holes.
    JOB_TITLE: args.intake.job_title || undefined,
    HIRE_DATE: formatDate(args.intake.hire_date),
    TERMINATION_DATE: formatDate(args.intake.termination_date),
    ANNUAL_SALARY: typeof args.intake.annual_salary === 'number'
      ? formatMoney(args.intake.annual_salary) : undefined,
    AMOUNT: typeof args.demandAmount === 'number'
      ? formatMoney(args.demandAmount) : undefined,
    // The full generated HTML is injected as the main content
    // Individual sections can be parsed out if the template uses section-level placeholders
    LEGAL_ANALYSIS: args.generatedHtml || undefined,
    FACTS_SECTION: args.generatedHtml || undefined,
  };
}

// ── Template validation ──────────────────────────────────────────────────

export const templateUploadSchema = z.object({
  /** The lawyer's label for this variant ("Constructive dismissal").
   *  Omitted means the firm's Standard variant for the type. */
  variantLabel: z.string().trim().min(1).max(80).optional(),
  /** Supplied only when replacing a specific existing variant. */
  variantId: z.string().trim().min(1).max(80).optional(),
  /** Make this the type's default. The first variant is always default. */
  isDefault: z.boolean().optional(),
  documentType: z.enum([
    'demand_letter', 'statement_of_claim', 'notice_of_application',
    'hrto_application', 'esa_complaint', 'discovery_plan',
    'affidavit_of_documents', 'mediation_brief',
    'severance_assessment', 'counter_offer',
    'reply', 'rule49_offer', 'settlement_minutes', 'retainer_agreement', 'mitigation_log',
    'settlement_conference_brief', 'hrto_schedule_a',
  ]),
  name: z.string().trim().min(1).max(200),
  /** Base64-encoded DOCX file content. */
  templateBase64: z.string().min(1).max(10_000_000), // ~7.5MB decoded
});
