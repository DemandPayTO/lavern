/**
 * Claw Mode — Selective Legal Document Anonymisation.
 *
 * Redacts IDENTIFYING information that has zero value for legal analysis:
 *   - Party/individual names
 *   - Email addresses, phone numbers, street addresses
 *   - Government IDs (SIN, driver's licence, passport)
 *   - Financial IDs (bank accounts, credit cards)
 *   - Health/insurance card numbers
 *   - Dates of birth (but NOT other dates — those are analytically important)
 *
 * PRESERVES information that Claude needs for legal reasoning:
 *   - Monetary amounts / salaries (essential for severance calculations, ESA thresholds)
 *   - Dates (essential for tenure, limitation periods, notice periods)
 *   - Job titles and roles (essential for Bardal factors)
 *   - Duration / tenure (essential for common law range)
 *
 * All logic is local — regex only, no external dependencies, no LLM calls.
 * The mapping table is returned so the process can be reversed after analysis.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type EntityType =
  | 'party'
  | 'address'
  | 'email'
  | 'phone'
  | 'sin'
  | 'financial'
  | 'health_id'
  | 'drivers_licence'
  | 'passport'
  | 'dob';

export interface EntityMapping {
  /** Stable placeholder, e.g. "[PARTY_1]", "[SIN_1]" */
  placeholder: string;
  /** Original matched text */
  original: string;
  /** Entity category */
  type: EntityType;
}

export interface AnonymizationResult {
  /** Text with identifying entities replaced by placeholders */
  anonymizedText: string;
  /** Complete mapping table for reversal */
  mappings: EntityMapping[];
  /** Per-category counts of unique entities found */
  stats: {
    parties: number;
    addresses: number;
    emails: number;
    phones: number;
    sins: number;
    financial: number;
    healthIds: number;
    driversLicences: number;
    passports: number;
    dobs: number;
  };
}

// ── Constants ────────────────────────────────────────────────────────────

/** Common legal terms that should never be treated as party names. */
const SKIP_TERMS = new Set([
  'agreement',
  'services',
  'confidential information',
  'effective date',
  'term',
  'party',
  'parties',
]);

/** Labels used in placeholder names, keyed by EntityType. */
const TYPE_LABELS: Record<EntityType, string> = {
  party: 'PARTY',
  address: 'ADDRESS',
  email: 'EMAIL',
  phone: 'PHONE',
  sin: 'SIN',
  financial: 'FINANCIAL',
  health_id: 'HEALTH_ID',
  drivers_licence: 'DL',
  passport: 'PASSPORT',
  dob: 'DOB',
};

// ── Regex patterns ───────────────────────────────────────────────────────

// -- Existing (kept) --

/** Email addresses. */
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Phone numbers — US, Canadian, and international formats.
 * Matches: +1 (555) 123-4567, +44 20 7946 0958, 555-123-4567, (555) 123 4567
 */
const PHONE_RE = /(?:\+\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/g;

// -- New: Government IDs --

/**
 * Canadian Social Insurance Number (SIN).
 * Format: 123-456-789 or 123 456 789 or 123456789 (9 digits).
 * Only matches when preceded by a SIN label to avoid false positives on
 * other 9-digit sequences.
 */
const SIN_LABELLED_RE = /(?:SIN|S\.I\.N\.?|Social\s+Insurance\s+(?:Number|No\.?|#))\s*:?\s*(\d{3}[\s\-]?\d{3}[\s\-]?\d{3})/gi;
/** Bare 9-digit SIN pattern (xxx-xxx-xxx or xxx xxx xxx) — only dashed/spaced form to reduce false positives. */
const SIN_BARE_RE = /\b\d{3}[\-\s]\d{3}[\-\s]\d{3}\b/g;

/**
 * Canadian driver's licence numbers.
 * Ontario: letter + 4 digits + hyphen + 5 digits + hyphen + 5 digits (e.g. A1234-56789-01234)
 * Other provinces vary but are typically 5–15 alphanumeric characters.
 * Only matches when preceded by a label.
 */
const DRIVERS_LICENCE_RE = /(?:driver'?s?\s+licen[cs]e|DL|D\.L\.)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9][\w\-]{4,14})/gi;

/**
 * Passport numbers — alphanumeric, 6–9 characters, preceded by a label.
 */
const PASSPORT_RE = /(?:passport)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z]{1,2}\d{5,7})/gi;

// -- New: Financial IDs --

/**
 * Credit card numbers — 13–19 digits, optionally grouped with spaces or dashes.
 * Common formats: 4111-1111-1111-1111, 4111 1111 1111 1111, 5500000000000004
 */
const CREDIT_CARD_RE = /\b(?:\d{4}[\s\-]?){3,4}\d{1,4}\b/g;

/**
 * Bank account / routing numbers — preceded by a label.
 * Matches "account number: 123456789" or "routing #: 0123456" etc.
 */
const BANK_ACCOUNT_RE = /(?:account|acct|routing|transit|institution)\s*(?:number|no\.?|#)?\s*:?\s*(\d{4,12})/gi;

// -- New: Health / Insurance IDs --

/**
 * Canadian health card numbers (OHIP, RAMQ, etc.) — preceded by a label.
 * OHIP: 10 digits, often with a version code letter (e.g. 1234-567-890-AB)
 */
const HEALTH_CARD_RE = /(?:health\s*card(?:\s+(?:number|no\.?|#))?|OHIP|RAMQ|health\s+(?:insurance|plan)\s*(?:number|no\.?|#)?|PHN)\s*:?\s*([\dA-Z][\dA-Z\s\-]{6,15})/gi;

/**
 * Generic insurance policy numbers — preceded by a label.
 */
const INSURANCE_NUM_RE = /(?:insurance|policy|group)\s*(?:number|no\.?|#)\s*:?\s*([\w\-]{5,15})/gi;

// -- New: Addresses --

/**
 * Canadian postal codes (A1A 1A1 or A1A1A1).
 */
const POSTAL_CODE_RE = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/gi;

/**
 * Street addresses — number + street name + type.
 * Matches: "123 Maple Street", "4500 Yonge St.", "1 King St W, Suite 200"
 */
const STREET_ADDRESS_RE = /\b\d{1,5}\s+(?:[A-Z][a-zA-Z]*\s+){1,3}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Court|Ct\.?|Place|Pl\.?|Way|Lane|Ln\.?|Crescent|Cres\.?|Circle|Cir\.?|Trail|Tr\.?)(?:\s*[,.]?\s*(?:Suite|Ste\.?|Unit|Apt\.?|#)\s*\d{1,5})?/gi;

// -- New: Date of Birth --

/**
 * Date of birth — only when preceded by a DOB label.
 * Preserves all other dates (hire dates, termination dates, etc.).
 */
const DOB_LONG_RE = /(?:date\s+of\s+birth|DOB|d\.o\.b\.?|born|birth\s*date)\s*:?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi;
const DOB_NUMERIC_RE = /(?:date\s+of\s+birth|DOB|d\.o\.b\.?|born|birth\s*date)\s*:?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/gi;
const DOB_ISO_RE = /(?:date\s+of\s+birth|DOB|d\.o\.b\.?|born|birth\s*date)\s*:?\s*\d{4}-\d{2}-\d{2}/gi;

// ── Internal helpers ─────────────────────────────────────────────────────

interface FoundEntity {
  start: number;
  end: number;
  text: string;
  type: EntityType;
}

/**
 * Collect all regex matches for a given pattern and entity type.
 */
function collectMatches(text: string, re: RegExp, type: EntityType): FoundEntity[] {
  const results: FoundEntity[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push({ start: m.index, end: m.index + m[0].length, text: m[0], type });
  }
  return results;
}

/**
 * Collect regex matches using a capture group (for labelled patterns).
 * The full match is replaced, but only the captured group is stored as the original.
 */
function collectLabelledMatches(text: string, re: RegExp, type: EntityType): FoundEntity[] {
  const results: FoundEntity[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Replace the full match (label + value) to avoid leaving a dangling label
    results.push({ start: m.index, end: m.index + m[0].length, text: m[0], type });
  }
  return results;
}

/**
 * Build a case-insensitive regex that matches a literal term, bounded by
 * non-word lookarounds rather than \b. A term ending in punctuation
 * ("Acme Widgets Inc.") has no \b after the "." + space, so a \b-anchored
 * pattern would fail to match and leak the name; (?<!\w)...(?!\w) matches
 * whether the term edge is a word char or punctuation.
 */
function termRegex(term: string): RegExp {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!\\w)${escaped}(?!\\w)`, 'gi');
}

/**
 * Check whether a span overlaps any already-claimed range.
 */
function overlaps(span: { start: number; end: number }, claimed: { start: number; end: number }[]): boolean {
  return claimed.some((c) => span.start < c.end && span.end > c.start);
}

/**
 * Filter out credit-card-like matches that are obviously not card numbers.
 * Must be 13–19 digits (ignoring separators) to be a valid card number.
 */
function isPlausibleCardNumber(match: string): boolean {
  const digitsOnly = match.replace(/[\s\-]/g, '');
  return digitsOnly.length >= 13 && digitsOnly.length <= 19 && /^\d+$/.test(digitsOnly);
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Anonymise a legal document by replacing IDENTIFYING entities with stable
 * placeholders. Preserves dates, monetary amounts, and other analytically
 * important data.
 *
 * @param text          The document text to anonymise.
 * @param definedTerms  Optional array of legal defined terms to treat as
 *                      party names (e.g. "Licensee", "Acme Corp").
 * @returns             The anonymised text, mapping table, and stats.
 */
export function anonymize(text: string, definedTerms?: string[]): AnonymizationResult {
  const knownEntities = new Map<string, string>();
  const counters: Record<EntityType, number> = {
    party: 0,
    address: 0,
    email: 0,
    phone: 0,
    sin: 0,
    financial: 0,
    health_id: 0,
    drivers_licence: 0,
    passport: 0,
    dob: 0,
  };
  const mappings: EntityMapping[] = [];

  function register(original: string, type: EntityType): string {
    const key = `${type}::${original.toLowerCase().trim()}`;
    const existing = knownEntities.get(key);
    if (existing) return existing;

    counters[type] += 1;
    const placeholder = `[${TYPE_LABELS[type]}_${counters[type]}]`;
    knownEntities.set(key, placeholder);
    mappings.push({ placeholder, original, type });
    return placeholder;
  }

  // ── Step 1: Collect all entity spans ───────────────────────────────

  const allEntities: FoundEntity[] = [];

  // 1a. Party names from definedTerms (longest first)
  if (definedTerms && definedTerms.length > 0) {
    const sorted = [...definedTerms].sort((a, b) => b.length - a.length);
    for (const term of sorted) {
      if (SKIP_TERMS.has(term.toLowerCase())) continue;
      const re = termRegex(term);
      allEntities.push(...collectMatches(text, re, 'party'));
    }
  }

  // 1b. Dates of birth (labelled — must come before general date patterns would)
  allEntities.push(...collectLabelledMatches(text, DOB_LONG_RE, 'dob'));
  allEntities.push(...collectLabelledMatches(text, DOB_NUMERIC_RE, 'dob'));
  allEntities.push(...collectLabelledMatches(text, DOB_ISO_RE, 'dob'));

  // 1c. Government IDs
  allEntities.push(...collectLabelledMatches(text, SIN_LABELLED_RE, 'sin'));
  allEntities.push(...collectMatches(text, SIN_BARE_RE, 'sin'));
  allEntities.push(...collectLabelledMatches(text, DRIVERS_LICENCE_RE, 'drivers_licence'));
  allEntities.push(...collectLabelledMatches(text, PASSPORT_RE, 'passport'));

  // 1d. Financial IDs
  allEntities.push(...collectLabelledMatches(text, BANK_ACCOUNT_RE, 'financial'));
  const cardMatches = collectMatches(text, CREDIT_CARD_RE, 'financial');
  allEntities.push(...cardMatches.filter(m => isPlausibleCardNumber(m.text)));

  // 1e. Health / insurance IDs
  allEntities.push(...collectLabelledMatches(text, HEALTH_CARD_RE, 'health_id'));
  allEntities.push(...collectLabelledMatches(text, INSURANCE_NUM_RE, 'health_id'));

  // 1f. Addresses
  allEntities.push(...collectMatches(text, STREET_ADDRESS_RE, 'address'));
  allEntities.push(...collectMatches(text, POSTAL_CODE_RE, 'address'));

  // 1g. Emails
  allEntities.push(...collectMatches(text, EMAIL_RE, 'email'));

  // 1h. Phones
  allEntities.push(...collectMatches(text, PHONE_RE, 'phone'));

  // NOTE: Monetary amounts and general dates are NOT collected.
  // They are preserved in the output because Claude needs them for legal analysis.

  // ── Step 2: Deduplicate overlapping spans (longest first) ──────────

  allEntities.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);

  const claimed: { start: number; end: number; placeholder: string }[] = [];

  for (const entity of allEntities) {
    if (overlaps(entity, claimed)) continue;
    const placeholder = register(entity.text, entity.type);
    claimed.push({ start: entity.start, end: entity.end, placeholder });
  }

  // ── Step 3: Build anonymised text (process replacements back-to-front) ─

  claimed.sort((a, b) => b.start - a.start);

  let result = text;
  for (const span of claimed) {
    result = result.slice(0, span.start) + span.placeholder + result.slice(span.end);
  }

  return {
    anonymizedText: result,
    mappings,
    stats: {
      parties: counters.party,
      addresses: counters.address,
      emails: counters.email,
      phones: counters.phone,
      sins: counters.sin,
      financial: counters.financial,
      healthIds: counters.health_id,
      driversLicences: counters.drivers_licence,
      passports: counters.passport,
      dobs: counters.dob,
    },
  };
}

/**
 * Reverse anonymisation by replacing placeholders with their original values.
 *
 * Processes placeholders in reverse order of length to avoid partial
 * replacements (e.g. `[PARTY_10]` before `[PARTY_1]`).
 */
export function deanonymize(text: string, mappings: EntityMapping[]): string {
  const sorted = [...mappings].sort((a, b) => b.placeholder.length - a.placeholder.length);

  let result = text;
  for (const { placeholder, original } of sorted) {
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, original);
    }
  }
  return result;
}

/**
 * Apply de-anonymisation to an array of findings, restoring original
 * entities in both `content` and `evidence` fields.
 */
export function deanonymizeFindings(
  findings: Array<{ content: string; evidence?: string }>,
  mappings: EntityMapping[],
): Array<{ content: string; evidence?: string }> {
  return findings.map((finding) => ({
    content: deanonymize(finding.content, mappings),
    evidence: finding.evidence !== undefined ? deanonymize(finding.evidence, mappings) : undefined,
  }));
}
