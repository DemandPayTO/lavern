/**
 * The pleading nodes: which causes of action a Statement of Claim pleads,
 * and the settled language each one is pleaded in.
 *
 * A statement of claim is the most deterministic document Starling
 * generates. It follows a formula the pilot stated exactly: if pleading
 * cause of action X, then plead Y, and substantiate with Z facts. The X
 * and Y almost never change; only the facts do. So the causes live here as
 * NODES, ported from the DemandPay SOC content blocks the pilot built:
 * each with a trigger condition, an assembly order, a section header, and
 * a body of settled pleading language with {{placeholder}} slots and
 * {{#if}} conditionals for the optional grounds inside it.
 *
 * SELECTION IS THREE LAYERS, in order of authority:
 *
 * 1. The TRIGGER computes eligibility from the intake, exactly as
 *    DemandPay evaluates it (same grammar, same semantics).
 * 2. The lawyer's APPROVED ISSUES gate whether an eligible cause renders.
 *    A field can say constructive dismissal all it likes; if the lawyer
 *    dismissed that issue, the claim does not plead it, and a note says
 *    the intake supported it. Every document on a matter obeys the same
 *    approvals or the documents contradict each other.
 * 3. The lawyer's OVERRIDE beats both. Forcing a node on buys the firm's
 *    settled structure with [LAWYER: ...] markers where the facts were
 *    never collected. It never buys invented facts.
 *
 * The node CONTENT is data (soc-nodes-data.json), not code, so the
 * importer can replace it per firm without touching this module.
 */

import { createLogger } from '../utils/logger.js';
import { ISSUE_TO_GATE } from './gate-evaluator.js';
import type { EmploymentIntakeData, IntakeAnalysisResult, GateResult } from '../types/employment-intake.js';
import nodesData from './soc-nodes-data.json' with { type: 'json' };

const logger = createLogger('SOC-NODES');

// ── The nodes ────────────────────────────────────────────────────────────

export interface SocNode {
  blockId: string;
  tier: 1 | 2;
  sectionHeader: string;
  triggerCondition: string;
  assemblyOrder: number;
  /** The firm marked this block as needing lawyer review whenever used. */
  lawyerReview: boolean;
  content: string;
  notes?: string;
}

export function loadSocNodes(): SocNode[] {
  return (nodesData.nodes as Array<Record<string, string>>).map(n => ({
    blockId: n.blockId,
    tier: (n.tier.trim().startsWith('2') ? 2 : 1) as 1 | 2,
    // "STATUTORY PLEADING — no section header" is an instruction, not a
    // heading: the block renders as bare paragraphs.
    sectionHeader: /no section/i.test(n.sectionHeader) ? '' : n.sectionHeader.trim(),
    triggerCondition: n.triggerCondition.split('—')[0].trim() || 'ALWAYS',
    assemblyOrder: parseInt(n.assemblyOrder, 10) || 99,
    lawyerReview: /yes/i.test(n.lawyerReview),
    content: n.content,
    notes: n.notes || undefined,
  })).sort((a, b) => a.assemblyOrder - b.assemblyOrder);
}

/**
 * The firm's own language over the ported defaults.
 *
 * Overrides carry CONTENT ONLY. Trigger, order, header and review marking
 * stay from the default set, which is what keeps a language edit from
 * changing which claims plead what.
 */
export function mergeFirmNodes(
  defaults: SocNode[],
  overrides: Array<{ block_id: string; content: string }>,
): SocNode[] {
  const byId = new Map(overrides.map(o => [o.block_id, o.content]));
  return defaults.map(n => byId.has(n.blockId) ? { ...n, content: byId.get(n.blockId)! } : n);
}

/** The one block whose body is written by the model, never from template. */
export const AI_NARRATIVE_BLOCK = 'SOC_FACTS_01';

// ── Approval mapping (layer 2) ───────────────────────────────────────────

/**
 * Which gate speaks for each node when deciding whether the lawyer has
 * approved the cause. A node maps to a gate; an approved issue maps to a
 * gate via ISSUE_TO_GATE; the node renders when they meet.
 *
 * Nodes with NO entry have no Starling issue that computes them (the
 * intake never fed the Issues tab for these causes), so the picker toggle
 * IS the approval: they render only when forced on.
 */
const NODE_GATE: Record<string, string> = {
  SOC_TERM_CLAUSE_01: 'G3',
  SOC_BAD_FAITH_01: 'G11',
  SOC_ESA_01: 'G9',
  SOC_HRC_01: 'G10',
  SOC_CD_01: 'G5',
  SOC_INDUCE_01: 'G7',
  SOC_MISREP_01: 'G7',
  SOC_COMMON_EMPLOYER_01: 'G8',
  SOC_RESTRICT_01: 'G13',
};

/** Tier 1 blocks are the skeleton of the pleading; they need no approval. */
function needsApproval(node: SocNode): boolean {
  return node.tier === 2 || node.blockId === 'SOC_TERM_CLAUSE_01' || node.blockId === 'SOC_BAD_FAITH_01';
}

// ── The evaluation context (layer 1) ─────────────────────────────────────

export interface SocEvalInput {
  intake: EmploymentIntakeData;
  analysis: IntakeAnalysisResult | null;
  gates: GateResult[];
  approvedIssues: string[];
  claimAmount: number;
}

const cad = (n: number): string => Math.round(n).toLocaleString('en-CA');

function longDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * DemandPay field names, computed from the Starling matter.
 *
 * The mapping is EXPLICIT rather than clever: every DemandPay name the
 * triggers and conditionals use is assigned here, from the Starling field
 * that answers it, so a rename on either side breaks loudly in tests
 * rather than quietly in a pleading. A field with no Starling source stays
 * undefined, which the status logic reports as "the intake never asked".
 */
export function buildSocEvalContext(input: SocEvalInput): Record<string, unknown> {
  const { intake, analysis, gates } = input;
  const gateFired = (id: string) => gates.some(g => g.gate === id && g.triggered);
  const approvedGates = new Set(input.approvedIssues.map(i => ISSUE_TO_GATE[i]).filter(Boolean));

  const separationType = intake.is_constructive_dismissal === true
    ? 'CONSTRUCTIVE'
    : intake.resigned === true
      ? 'RESIGNED'
      : (intake.termination_date || intake.was_terminated) ? 'TERMINATED' : '';

  const cdChanges = intake.constructive_dismissal_details
    ?? (Array.isArray(intake.constructive_dismissal_grounds) && intake.constructive_dismissal_grounds.length > 0
      ? intake.constructive_dismissal_grounds.join(', ')
      : '');

  const badFaithActs = Array.isArray(intake.bad_faith_conduct) && intake.bad_faith_conduct.length > 0
    ? intake.bad_faith_conduct.join(', ')
    : (intake.bad_faith_details ?? '');

  const d = analysis?.damagesEstimate;

  const raw: Record<string, unknown> = {
    // Gate references, straight from Starling's own gate evaluation.
    gate_G9_fired: gateFired('G9') || approvedGates.has('G9'),
    gate_G10_fired: gateFired('G10') || approvedGates.has('G10'),
    gate_G14_fired: gateFired('G14') || approvedGates.has('G14'),

    // Separation.
    separation_type: separationType,
    cd_changes: cdChanges,

    // The contract.
    has_written_contract: intake.has_written_contract ?? (intake.termination_clause_text ? true : undefined),
    has_term_clause: intake.termination_clause_text?.trim() ? true : undefined,
    term_clause_text: intake.termination_clause_text ?? '',
    clause_cause_broader: intake.clause_cause_broader ?? input.approvedIssues.includes('waksdale_at_any_time'),
    clause_limits_below_esa: intake.clause_limits_below_esa ?? input.approvedIssues.includes('machtinger_below_esa'),
    clause_no_benefits: intake.clause_no_benefits,
    employer_breached_clause: intake.employer_breached_clause,

    // Bad faith and cause.
    bad_faith_acts: badFaithActs,
    bad_faith_termination_manner: badFaithActs ? true : undefined,
    false_cause_alleged: intake.false_cause_alleged ?? (intake.employer_alleged_just_cause === true ? undefined : undefined),

    // Inducement and misrepresentation.
    employer_initiated_recruitment: intake.employer_initiated_recruitment,
    had_prior_secure_employment: intake.had_prior_secure_employment ?? (intake.prior_employer_name ? true : undefined),
    promises_not_fulfilled: intake.promises_not_fulfilled,
    promises_known_false: intake.promises_known_false,

    // The five causes the Starling intake did not previously ask about.
    common_employer: intake.common_employer,
    defamatory_statements: intake.defamatory_statements,
    defamation_malicious: intake.defamation_malicious,
    privacy_breach: intake.privacy_breach,
    iims: intake.iims,
    unjust_enrichment: intake.unjust_enrichment,
    breach_express_term: intake.breach_express_term,
    breach_implied_term: intake.breach_implied_term,

    // Covenants.
    has_noncompete: intake.has_non_compete,
    has_nonsolicit: intake.has_non_solicitation,
    noncompete_post_oct2021: intake.noncompete_post_oct2021,
    covenant_enforcement_threat: intake.covenant_enforcement_threat,
    is_executive_noncompete: intake.is_executive_noncompete,
    noncompete_common_law: intake.noncompete_common_law,

    // Successor employer and the constructive dismissal framings. The
    // primary and alternative framings derive from how the file ended; the
    // cumulative and remote framings are the lawyer's own fields.
    prior_related_employer: intake.prior_related_employer,
    cd_primary: intake.is_constructive_dismissal === true || undefined,
    cd_alternative: (intake.was_terminated === true && cdChanges) ? true : undefined,
    cd_cumulative: intake.cd_cumulative,
    cd_remote: intake.cd_remote,
    shared_management: intake.shared_management,
    shared_payroll: intake.shared_payroll,
    shared_branding: intake.shared_branding,

    // Compensation conditionals.
    has_bonus: intake.bonus_amount ? true : (intake.bonus_type ? true : undefined),
    has_equity_comp: (Array.isArray(intake.equity_types) && intake.equity_types.length > 0) ? true : undefined,
    has_benefits: intake.has_benefits,
    has_rrsp: intake.pension_contribution_type ? true : intake.has_rrsp,
    has_car_allowance: intake.has_car_allowance,
    unpaid_commission: intake.unpaid_commission,
    unpaid_overtime: intake.unpaid_overtime,
    vacation_unpaid: intake.vacation_unpaid,
    unauthorized_deductions: intake.unauthorized_deductions,
    vacation_underpaid_rate: intake.vacation_underpaid_rate,
    vacation_excluded_variable_comp: intake.vacation_excluded_variable_comp,
    holiday_pay_unpaid: intake.holiday_pay_unpaid,
    expenses_unreimbursed: intake.expenses_unreimbursed,
    other_compensation: intake.other_compensation_details ? true : undefined,
    benefits_not_continued: intake.benefits_not_continued,

    // ESA shortfalls: the analysis knows the entitlements; whether they
    // were paid is the lawyer's field.
    esa_shortfall: intake.esa_shortfall,
    esa_term_shortfall: intake.esa_term_shortfall,
    esa_sev_shortfall: intake.esa_sev_shortfall,

    // Human rights.
    protected_ground: intake.hrc_protected_ground ?? '',
    hrc_complaint_made: intake.hrc_complaint_made,
    sexual_harassment: intake.sexual_harassment,
    accommodation_requested: intake.accommodation_requested,
    mental_distress_symptoms: intake.mental_distress_symptoms ?? '',
    positive_performance: intake.positive_performance,

    // Placeholders (values, not conditions).
    client_name: [intake.client_first_name, intake.client_last_name].filter(Boolean).join(' '),
    employer_name: intake.employer_legal_name ?? intake.employer_operating_name ?? '',
    client_city: intake.client_city ?? '',
    workplace_location: intake.workplace_location ?? intake.client_city ?? '',
    position_title: intake.job_title ?? '',
    hire_date: longDate(intake.hire_date ?? intake.first_day_of_work) ?? '',
    termination_date: longDate(intake.termination_date) ?? '',
    contract_date: longDate(intake.contract_date) ?? '',
    salary: intake.annual_salary ? cad(intake.annual_salary) : '',
    age: intake.client_age ?? analysis?.bardalFactors?.age ?? '',
    years_of_service: analysis?.bardalFactors?.tenureYears?.toFixed(1) ?? '',
    esa_notice_weeks: d?.esaNoticeWeeks ?? '',
    common_law_high: d?.commonLawHighMonths ?? '',
    total_claim: input.claimAmount ? cad(input.claimAmount) : '',
    duties_description: intake.job_duties ?? '',
    cause_reasons: intake.cause_allegations ?? '',
    prior_employer: intake.prior_employer_name ?? '',
    prior_service: intake.prior_employer_tenure ?? '',
    inducement_representations: intake.inducement_representations ?? intake.inducement_details ?? '',
    recruiter_name_and_title: intake.recruiter_name_and_title ?? '',
    bad_faith_acts_list: badFaithActs,
    defamation_recipients: intake.defamation_recipients ?? '',
    privacy_breach_description: intake.privacy_breach_description ?? '',
    iims_conduct_description: intake.iims_conduct_description ?? '',
    iims_illness_description: intake.iims_illness_description ?? '',
    unjust_enrichment_benefit: intake.unjust_enrichment_benefit ?? '',
    express_term_description: intake.express_term_description ?? '',
    express_term_obligation: intake.express_term_obligation ?? '',
    implied_term_conduct: intake.implied_term_conduct ?? '',
    common_employer_documentation: intake.common_employer_documentation ?? '',
    hrc_conduct_description: intake.hrc_conduct_description ?? '',
    // Compensation particulars the employment history block prints.
    bonus_amount: intake.bonus_amount ? cad(intake.bonus_amount) : '',
    commission_amount: intake.commission_amount ? cad(intake.commission_amount) : '',
    equity_type: Array.isArray(intake.equity_types) && intake.equity_types.length > 0 ? intake.equity_types.join(', ') : '',
    predecessor: intake.prior_employer_name ?? '',
    bad_faith_termination_particulars: intake.bad_faith_details ?? '',
  };

  // Pronouns: from the client file, the same three positions the letters
  // use. With nothing recorded the name carries every position.
  const name = String(raw.client_name || 'the Plaintiff');
  const PRONOUNS: Record<string, [string, string, string]> = {
    she: ['she', 'her', 'her'],
    he: ['he', 'him', 'his'],
    they: ['they', 'them', 'their'],
  };
  const set = intake.client_pronouns ? PRONOUNS[intake.client_pronouns] : undefined;
  raw.pronoun_subject = set?.[0] ?? name;
  raw.pronoun_object = set?.[1] ?? name;
  raw.pronoun_possessive = set?.[2] ?? `${name}'s`;

  return raw;
}

// ── The trigger evaluator (ported semantics) ─────────────────────────────

/** DemandPay's evalTrigger, ported verbatim in behaviour. */
export function evalTrigger(condition: string | null | undefined, ctx: Record<string, unknown>): boolean {
  if (!condition || condition.trim() === '' || condition.trim().toUpperCase() === 'ALWAYS') return true;

  const orParts = splitTopLevel(condition, /\s+OR\s+/i);
  if (orParts.length > 1) return orParts.some(p => evalTrigger(p, ctx));

  const andParts = splitTopLevel(condition, /\s+AND\s+/i);
  if (andParts.length > 1) return andParts.every(p => evalTrigger(p, ctx));

  let cond = condition.trim();
  // A fully parenthesised term unwraps.
  while (cond.startsWith('(') && cond.endsWith(')') && balanced(cond.slice(1, -1))) {
    cond = cond.slice(1, -1).trim();
  }
  if (cond !== condition.trim()) return evalTrigger(cond, ctx);

  const eq = cond.match(/^(\w+)\s*=\s*(\S+)$/);
  if (eq) {
    const actual = ctx[eq[1]];
    if (eq[2] === 'YES') return actual === true;
    if (eq[2] === 'NO') return actual === false;
    return String(actual ?? '') === eq[2];
  }

  const notEmpty = cond.match(/^(\w+)\s+IS\s+NOT\s+EMPTY$/i);
  if (notEmpty) {
    const v = ctx[notEmpty[1]];
    if (v === true) return true;
    if (v === false || v == null) return false;
    return String(v).trim().length > 0;
  }

  logger.warn('Unknown trigger condition; defaulting false', { condition: cond });
  return false;
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

/** Split on a connective, but never inside parentheses. */
function splitTopLevel(s: string, re: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  const tokens = s.split(/(\(|\))/);
  for (const tok of tokens) {
    if (tok === '(') { depth++; current += tok; continue; }
    if (tok === ')') { depth--; current += tok; continue; }
    if (depth === 0) {
      const pieces = tok.split(re);
      if (pieces.length > 1) {
        current += pieces[0];
        for (let i = 1; i < pieces.length; i++) {
          parts.push(current.trim());
          current = pieces[i];
        }
        continue;
      }
    }
    current += tok;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.length > 1 ? parts : [s];
}

/** Fields a condition reads, for saying WHY a node is off. */
export function conditionFields(condition: string): string[] {
  if (!condition || condition.trim().toUpperCase() === 'ALWAYS') return [];
  return [...new Set([...condition.matchAll(/\b([a-z_][a-z_0-9]*)\b(?=\s*(?:=|IS\s+NOT))/gi)].map(m => m[1]))];
}

// ── Status (all three layers) ────────────────────────────────────────────

export type NodeStatus = 'firing' | 'eligible_unapproved' | 'off' | 'forced_on' | 'forced_off';

export interface SocNodeStatus {
  blockId: string;
  sectionHeader: string;
  tier: 1 | 2;
  lawyerReview: boolean;
  status: NodeStatus;
  /** Why, in the lawyer's words. */
  reason: string;
  /** Trigger fields the intake never answered (undefined, not false). */
  unanswered: string[];
}

export function nodeStatuses(
  nodes: SocNode[],
  ctx: Record<string, unknown>,
  approvedIssues: string[],
  overrides: Record<string, 'on' | 'off'>,
): SocNodeStatus[] {
  const approvedGates = new Set(approvedIssues.map(i => ISSUE_TO_GATE[i]).filter(Boolean));

  return nodes.map(node => {
    const fields = conditionFields(node.triggerCondition);
    const unanswered = fields.filter(f => ctx[f] === undefined);
    const base = {
      blockId: node.blockId,
      sectionHeader: node.sectionHeader || node.blockId.replace(/^SOC_|_01$/g, '').replace(/_/g, ' '),
      tier: node.tier,
      lawyerReview: node.lawyerReview,
      unanswered,
    };

    const override = overrides[node.blockId];
    if (override === 'off') {
      return { ...base, status: 'forced_off' as const, reason: 'You turned this section off. It will not appear.' };
    }
    if (override === 'on') {
      return {
        ...base,
        status: 'forced_on' as const,
        reason: unanswered.length > 0
          ? `You turned this section on. The intake never answered ${unanswered.join(', ')}, so its particulars carry [LAWYER: ...] markers to complete.`
          : 'You turned this section on.',
      };
    }

    const eligible = evalTrigger(node.triggerCondition, ctx);
    if (!eligible) {
      return {
        ...base,
        status: 'off' as const,
        reason: unanswered.length > 0
          ? `The intake never answered ${unanswered.join(', ')}, so this cause cannot fire. Answer it on the Intake tab, or force the section on.`
          : `The facts on file do not meet: ${node.triggerCondition}.`,
      };
    }

    if (needsApproval(node)) {
      const gate = NODE_GATE[node.blockId];
      const approved = gate ? approvedGates.has(gate) : false;
      if (!approved) {
        return {
          ...base,
          status: 'eligible_unapproved' as const,
          reason: gate
            ? 'The facts support this cause, but no matching issue is approved on the Issues tab, so the claim does not plead it.'
            : 'The facts support this cause. It has no Issues-tab counterpart, so it pleads only when you turn it on here.',
        };
      }
    }

    return { ...base, status: 'firing' as const, reason: node.tier === 1 ? 'Part of every claim.' : 'Facts support it and the issue is approved.' };
  });
}

// ── Rendering ────────────────────────────────────────────────────────────

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** {{#if}}/{{#unless}}/{{else}} — DemandPay's semantics, iterated until stable. */
export function applyConditionals(body: string, ctx: Record<string, unknown>): string {
  const truthy = (field: string): boolean => {
    const v = ctx[field];
    if (v === true) return true;
    if (v === false || v == null) return false;
    const s = String(v).trim();
    return s.length > 0 && s !== 'No' && s !== '0' && s !== 'false';
  };
  let result = body;
  let prev = '';
  let guard = 0;
  while (result !== prev && guard < 20) {
    prev = result;
    result = result.replace(/\{\{#unless\s+([\w_]+)\}\}([\s\S]*?)\{\{\/unless(?:\s+[\w_]+)?\}\}/g,
      (_m, f, c) => (truthy(f) ? '' : c));
    result = result.replace(/\{\{#if\s+([\w_]+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if(?:\s+[\w_]+)?\}\}/g,
      (_m, f, a, b) => (truthy(f) ? a : b));
    result = result.replace(/\{\{#if\s+([\w_]+)\}\}([\s\S]*?)\{\{\/if(?:\s+[\w_]+)?\}\}/g,
      (_m, f, c) => (truthy(f) ? c : ''));
    guard++;
  }
  return result;
}

/**
 * Reletter (a), (b), (c) runs after conditionals removed some of them.
 * A relief list whose (c) and (d) did not fire must read (a) (b) (c), not
 * (a) (b) (e): a court document with a lettering gap looks edited.
 */
export function reletter(text: string): string {
  const lines = text.split('\n');
  let counter = 0;
  let inRun = false;
  const out = lines.map(line => {
    const m = line.match(/^(\s*)\(([a-z])\)(\s)/);
    if (m) {
      if (!inRun) { counter = 0; inRun = true; }
      const letter = String.fromCharCode(97 + counter);
      counter++;
      return line.replace(/^(\s*)\([a-z]\)/, `$1(${letter})`);
    }
    if (line.trim() !== '') inRun = false;
    return line;
  });
  return out.join('\n');
}

export interface RenderedSection {
  blockId: string;
  header: string;
  html: string;
  /** Placeholders the matter could not fill, left as [LAWYER: ...]. */
  missing: string[];
}

/** Render one node's body to HTML paragraphs, {{para}} kept for numbering. */
export function renderNode(node: SocNode, ctx: Record<string, unknown>): RenderedSection {
  const missing: string[] = [];
  let body = applyConditionals(node.content, ctx);
  body = reletter(body);

  // Placeholders. Values are escaped on the way in; the body's own tags
  // (blockquote around the clause text) survive.
  body = body.replace(/\{\{([a-z_][a-z_0-9]*)\}\}/g, (whole, name: string) => {
    if (name === 'para') return whole; // numbering pass owns this
    const v = ctx[name];
    if (v === undefined || v === null || String(v).trim() === '') {
      missing.push(name);
      return `[LAWYER: ${name.replace(/_/g, ' ')}]`;
    }
    return esc(String(v));
  });

  // Paragraphs: blank-line separated. Lettered items become indented
  // sub-paragraphs; {{para}} paragraphs are the numbered ones.
  const paragraphs = body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => {
    if (/^\(/.test(p)) return `<p class="sub">${p.replace(/\n/g, '<br>')}</p>`;
    if (/^</.test(p)) return p; // already markup (blockquote)
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  });

  return {
    blockId: node.blockId,
    header: node.sectionHeader,
    html: paragraphs.join('\n'),
    missing: [...new Set(missing)],
  };
}

/** Replace each {{para}} with the next paragraph number, document-wide. */
export function numberSocParagraphs(html: string, startFrom = 1): string {
  let n = startFrom;
  return html.replace(/\{\{para\}\}/g, () => String(n++));
}
