/**
 * OLRB Form Data Populators — datasets XML that pre-fills the official
 * OLRB Forms A-30 (response to a duty of fair representation application)
 * and A-53 (application under OHSA s. 50, unlawful reprisal).
 *
 * The Board's forms, like the HRTO SmartForms, are dynamic XFA documents:
 * they cannot be filled programmatically. The supported path is Acrobat's
 * data import (Prepare Form → More → Import Data) against the pristine
 * official form.
 *
 * Mapping philosophy (same as HRTO Form 1): populate ONLY what is held
 * with confidence: the style of cause, the contact identities, and the
 * organization details. Radio selections whose value vocabulary is not
 * documented in the data model, and every narrative question, are left
 * blank for the representative. The generated narrative documents (DFR
 * response, s. 50 application) are the substantive schedules.
 *
 * Blank data models extracted from the official forms (July 2026):
 * src/assets/forms/a30-datasets-blank.xml, a53-datasets-blank.xml.
 * Re-extract when the Board revises the forms.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setInSection, setInNestedSection } from '../documents/xfa-datasets.js';
import type { GrievanceIntakeData } from '../types/labour-intake.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A30_BLANK = path.resolve(__dirname, '../assets/forms/a30-datasets-blank.xml');
const A53_BLANK = path.resolve(__dirname, '../assets/forms/a53-datasets-blank.xml');

export interface OlrbRepresentativeInfo {
  representativeName?: string;
  organizationName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

function grievorName(intake: GrievanceIntakeData): string {
  return [intake.grievor_first_name, intake.grievor_last_name].filter(Boolean).join(' ');
}

function splitName(full: string | undefined): { first: string; last: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/** Heuristic split of the free-text grievor contact into email and phone. */
function contactParts(contact: string | undefined): { email?: string; phone?: string } {
  if (!contact) return {};
  const email = contact.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
  const phone = contact.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0];
  return { email, phone };
}

/**
 * Form A-30: the union's response to a s. 74 DFR application.
 * Part A1a is the responding union's contact block.
 */
export function buildA30DatasetsXml(intake: GrievanceIntakeData, rep?: OlrbRepresentativeInfo): string {
  let xml = fs.readFileSync(A30_BLANK, 'utf8');

  // Style of cause: the DFR applicant is the grievor; the union and the
  // employer are the responding parties.
  xml = setInSection(xml, 'betweenAnd', 'applicant', grievorName(intake));
  xml = setInSection(xml, 'betweenAnd', 'respondingPartyTradeUnion', intake.union_name ?? '');
  xml = setInSection(xml, 'betweenAnd', 'respondingPartyEmployer', intake.employer_name ?? '');

  // The responding union's contact (formA30 → partA1a)
  const repName = splitName(rep?.representativeName);
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'orgName', rep?.organizationName ?? intake.union_name ?? '');
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'firstName', repName.first);
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'lastName', repName.last);
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'position', rep?.representativeName ? 'Representative' : '');
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'fullAddress', rep?.address ?? '');
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'phone', rep?.phone ?? '');
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'email', rep?.email ?? '');
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'province', 'Ontario');
  xml = setInNestedSection(xml, 'formA30', 'partA1a', 'country', 'Canada');

  return xml;
}

/**
 * Form A-53: application under OHSA s. 50 (unlawful reprisal).
 * Part A1a is the applicant worker; Part A2a is the responding employer.
 */
export function buildA53DatasetsXml(intake: GrievanceIntakeData, rep?: OlrbRepresentativeInfo): string {
  let xml = fs.readFileSync(A53_BLANK, 'utf8');

  xml = setInSection(xml, 'betweenAnd', 'applicant', grievorName(intake));
  xml = setInSection(xml, 'betweenAnd', 'respondingPartyEmployer', intake.employer_name ?? '');

  // Applicant worker (formA53 → partA1a)
  xml = setInNestedSection(xml, 'formA53', 'partA1a', 'firstName', intake.grievor_first_name ?? '');
  xml = setInNestedSection(xml, 'formA53', 'partA1a', 'lastName', intake.grievor_last_name ?? '');
  xml = setInNestedSection(xml, 'formA53', 'partA1a', 'position', intake.grievor_classification ?? '');
  const contact = contactParts(intake.grievor_contact);
  xml = setInNestedSection(xml, 'formA53', 'partA1a', 'email', contact.email ?? '');
  xml = setInNestedSection(xml, 'formA53', 'partA1a', 'phone', contact.phone ?? '');
  xml = setInNestedSection(xml, 'formA53', 'partA1a', 'province', 'Ontario');
  xml = setInNestedSection(xml, 'formA53', 'partA1a', 'country', 'Canada');

  // Responding employer (formA53 → partA2a)
  xml = setInNestedSection(xml, 'formA53', 'partA2a', 'orgName', intake.employer_name ?? '');
  xml = setInNestedSection(xml, 'formA53', 'partA2a', 'fullAddress', intake.workplace_location ?? '');
  xml = setInNestedSection(xml, 'formA53', 'partA2a', 'province', 'Ontario');
  xml = setInNestedSection(xml, 'formA53', 'partA2a', 'country', 'Canada');

  return xml;
}

/** Download filename for a populated data file. */
export function olrbDataFilename(form: 'a30' | 'a53', intake: GrievanceIntakeData): string {
  const who = grievorName(intake).replace(/[^A-Za-z0-9 ]/g, '').trim().replace(/\s+/g, '-') || 'grievor';
  return `olrb-form-${form}-data-${who}.xml`.toLowerCase();
}
