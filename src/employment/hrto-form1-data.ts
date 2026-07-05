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
import { sectionBounds, setFirstInRange, setInSection } from '../documents/xfa-datasets.js';

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
