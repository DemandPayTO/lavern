/**
 * HRTO Form 1 Data Populator — generates the XFA datasets XML that
 * pre-fills the official HRTO Form 1 SmartForm.
 *
 * WHY XML, NOT A FILLED PDF: the HRTO SmartForms are encrypted dynamic
 * XFA (LiveCycle) documents — they report one page and zero AcroForm
 * fields to standard PDF tooling. The supported, version-tolerant way to
 * populate them programmatically is Acrobat's data-import: the lawyer
 * opens the pristine official Form 1 and imports this XML
 * (Acrobat: Prepare Form → More → Import Data). Fields appear filled,
 * the lawyer reviews and completes what Starling deliberately leaves
 * blank, and files the official form.
 *
 * Mapping philosophy: populate ONLY what we hold with confidence
 * (identities, addresses, grounds, last-incident date, representative,
 * monetary-remedy flag). Narrative questions reference Schedule "A".
 * Everything else stays blank for the lawyer — a wrong pre-filled answer
 * is worse than an empty field.
 *
 * The blank data model (src/assets/forms/form1-datasets-blank.xml) was
 * extracted from the official Form 1 v1.5. Re-extract when the HRTO
 * revises the form (see src/assets/forms/README.md).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmploymentIntakeData } from '../types/employment-intake.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLANK_DATASETS_PATH = path.resolve(__dirname, '../assets/forms/form1-datasets-blank.xml');

// ── Ground mapping: Starling intake enum → Form 1 checkbox nodes ────────

const GROUND_TO_CHECKBOXES: Record<string, string[]> = {
  age: ['chkAge'],
  ancestry_race: ['chkRace', 'chkAncestry', 'chkColour', 'chkEthnicOrigin'],
  creed_origin: ['chkCreed', 'chkPlaceOfOrigin'],
  disability: ['chkDisability'],
  family_status: ['chkFamily'],
  gender_identity: ['chkGenderIdentity'],
  marital_status: ['chkMaritalStatus'],
  record_of_offences: ['chkRecordOfOffences'],
  sex: ['chkSexGender'],
  sexual_orientation: ['chkSexOrientation'],
  // 'other' intentionally unmapped — the lawyer selects manually
};

export interface Form1RepresentativeInfo {
  lawyerName?: string;
  firmName?: string;
  lsoNumber?: string;
}

// ── XML helpers (anchor-sliced replacement — the data model repeats node
// names across sections, so every set is scoped to a named section) ─────

function escapeXml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Section slice: from the first `<sectionName>` to its closing tag.
 * Name-boundary aware — `</sfrmRespondent` must NOT match
 * `</sfrmRespondentType` (they are prefixes of each other).
 */
function sectionBounds(xml: string, sectionName: string, from = 0): { start: number; end: number } | null {
  const openRe = new RegExp(`<${sectionName}(?=[\\s/>])`, 'g');
  openRe.lastIndex = from;
  const open = openRe.exec(xml);
  if (!open) return null;
  const closeRe = new RegExp(`</${sectionName}(?=[\\s>])`, 'g');
  closeRe.lastIndex = open.index;
  const close = closeRe.exec(xml);
  if (!close) return null;
  return { start: open.index, end: close.index };
}

/**
 * Set the FIRST occurrence of `<tag ... />` or `<tag>...</tag>` within
 * [start, end) to the given value. Returns updated xml (bounds shift!).
 */
function setFirstInRange(xml: string, start: number, end: number, tag: string, value: string): string {
  const slice = xml.slice(start, end);
  const escaped = escapeXml(value);

  // Self-closing form: <tag\n/> or <tag/>
  const selfClose = new RegExp(`<${tag}(\\s*\\n?)/>`);
  if (selfClose.test(slice)) {
    return xml.slice(0, start) + slice.replace(selfClose, `<${tag}\n>${escaped}</${tag}\n>`) + xml.slice(end);
  }
  // Value form: <tag\n>old</tag\n>
  const valueForm = new RegExp(`(<${tag}\\s*\\n?>)[^<]*(</${tag})`);
  if (valueForm.test(slice)) {
    return xml.slice(0, start) + slice.replace(valueForm, `$1${escaped}$2`) + xml.slice(end);
  }
  return xml; // tag not present in this section — leave untouched
}

/** Convenience: set tag inside the first `sectionName` section. */
function setInSection(xml: string, sectionName: string, tag: string, value: string | undefined | null): string {
  if (value == null || value === '') return xml;
  const bounds = sectionBounds(xml, sectionName);
  if (!bounds) return xml;
  return setFirstInRange(xml, bounds.start, bounds.end, tag, String(value));
}

// ── Main ─────────────────────────────────────────────────────────────────

/**
 * Build the Form 1 datasets XML from intake data.
 * Returns the XML string ready for download / Acrobat import.
 */
export function buildForm1DatasetsXml(
  intake: EmploymentIntakeData,
  rep?: Form1RepresentativeInfo,
): string {
  let xml = fs.readFileSync(BLANK_DATASETS_PATH, 'utf8');
  const i = intake as Record<string, unknown>;

  // ── Applicant contact (first sfrmApplicant section) ──────────────────
  xml = setInSection(xml, 'sfrmApplicant', 'txtLastName', i.client_last_name as string);
  xml = setInSection(xml, 'sfrmApplicant', 'txtFirstName', i.client_first_name as string);
  xml = setInSection(xml, 'sfrmApplicant', 'txtEmail', i.client_email as string);
  xml = setInSection(xml, 'sfrmApplicant', 'txtLine1', i.client_address as string);
  xml = setInSection(xml, 'sfrmApplicant', 'txtCity', i.client_city as string);
  xml = setInSection(xml, 'sfrmApplicant', 'txtPostalCode', i.client_postal_code as string);
  xml = setInSection(xml, 'sfrmApplicant', 'txtPhone', i.client_phone as string);

  // ── Respondent organization (sfrmRespondent → Organization) ─────────
  xml = setInSection(xml, 'sfrmRespondent', 'txtOrgName',
    (i.employer_legal_name as string) || (i.employer_operating_name as string));
  xml = setInSection(xml, 'sfrmRespondent', 'txtLine1', i.employer_address as string);

  // ── Representative (sfrmRepresentative: chkLawyer + txtLSO) ─────────
  if (rep?.lawyerName || rep?.lsoNumber) {
    xml = setInSection(xml, 'sfrmRepresentative', 'chkLawyer', '1');
    if (rep.lsoNumber) xml = setInSection(xml, 'sfrmRepresentative', 'txtLSO', rep.lsoNumber);
  }

  // ── Grounds checkboxes (sfrmListofGrounds) ───────────────────────────
  const grounds = (i.discrimination_grounds as string[] | undefined) ?? [];
  for (const ground of grounds) {
    for (const chk of GROUND_TO_CHECKBOXES[ground] ?? []) {
      xml = setInSection(xml, 'sfrmListofGrounds', chk, '1');
    }
  }
  if (i.experienced_reprisal) {
    xml = setInSection(xml, 'sfrmListofGrounds', 'chkReprisal', '1');
  }

  // ── Date of last event — the s. 34(1) limitation anchor ─────────────
  // Last incident is typically the termination for dismissal-based claims.
  const lastEvent = (i.termination_date as string) || (i.last_day_worked as string);
  if (lastEvent) {
    xml = setInSection(xml, 'HRTO_Form_1', 'dtpDateofLastEvent', lastEvent);
  }

  // ── Remedy: monetary flag + Schedule A cross-references ─────────────
  xml = setInSection(xml, 'sfrmRemedy', 'chkMonetary', '1');
  const remedyBounds = sectionBounds(xml, 'sfrmRemedy');
  if (remedyBounds) {
    xml = setFirstInRange(xml, remedyBounds.start, remedyBounds.end, 'txtAnswer',
      'See Schedule "A" attached for the calculation and basis of the monetary remedy sought.');
  }

  return xml;
}

/** Filename for the download. */
export function form1DataFilename(intake: EmploymentIntakeData): string {
  const last = (intake as Record<string, unknown>).client_last_name as string | undefined;
  return `HRTO-Form1-data${last ? `-${last.replace(/[^A-Za-z0-9-]/g, '')}` : ''}.xml`;
}
