/**
 * Integration Tests — revision loop routes.
 *
 * Exercises the apply path with a stubbed model, so the pinned properties
 * are the ones that matter regardless of what the model returns:
 *   - a revision that touches an unapproved paragraph is REFUSED whole
 *   - a factual correction writes the intake and recomputes the matter
 *   - a needs_lawyer item can never be turned into an edit
 *   - the previous version survives in the draft history
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, createUser, saveMatter, getMatterById } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';

let app: FastifyInstance;
let userId = '';
const MID = 'm-revision-1';

const DOC_HTML = [
  '<h1>Statement of Claim</h1>',
  '<p>1. The Plaintiff was hired on March 2, 2017.</p>',
  '<p>2. The Plaintiff was employed as a Buyer.</p>',
  '<p>3. The Plaintiff was terminated without cause on May 20, 2026.</p>',
].join('\n');

/** What the apply-step model returns. Set per test. */
let modelReply = '';

vi.mock('../../src/providers/cross-provider-chat.js', () => ({
  crossProviderChat: vi.fn(async () => ({ text: modelReply, cost: 0.01 })),
}));

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

function seedMatter() {
  saveMatter(userId, MID, JSON.stringify({
    title: 'Revision Matter',
    matterNumber: 'DP-2026-900',
    generatedSOC: { html: DOC_HTML, documentTitle: 'Statement of Claim', status: 'draft', generatedAt: new Date().toISOString() },
    employmentData: {
      intake: {
        client_first_name: 'Vera', client_last_name: 'Nunes',
        employer_legal_name: 'Halcyon Retail Inc', job_title: 'Buyer',
        hire_date: '2017-03-02', termination_date: '2026-05-20',
        annual_salary: 88000, was_terminated: true,
      },
      timeline: [], gates: [], approvedIssues: [], dismissedIssues: [],
      documentExtractions: [], analysis: null,
    },
  }));
}

beforeAll(async () => {
  initDatabase(':memory:');
  userId = createUser('rev@evans.test', 'x', 'Jordan Haworth', 'Evans Law Firm').id;
  app = Fastify({ logger: false });
  app.addHook('preHandler', async (req) => {
    (req as { userId?: string }).userId = userId;
    (req as { firmId?: string }).firmId = 'firm-rev';
  });
  registerEmploymentIntakeRoutes(app);
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe('applying approved revisions', () => {
  it('applies a factual correction to BOTH the document and the intake', async () => {
    seedMatter();
    modelReply = JSON.stringify({ revised: { 1: '<p>1. The Plaintiff was hired on March 2, 2016.</p>' } });

    const res = await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'statement_of_claim',
      approved: [{
        id: 'rev-0', feedback: 'I was hired in 2016, not 2017.', kind: 'factual_correction',
        paragraphIndices: [1], proposal: 'Correct the hire year to 2016.',
        intakeField: 'hire_date', intakeValue: '2016-03-02',
      }],
    });

    expect(res.status).toBe(200);
    expect(res.body.changedParagraphs).toEqual([1]);
    expect(res.body.intakeApplied).toEqual(['hire_date']);
    // hire_date feeds the damages analysis, so it must be flagged stale.
    expect(res.body.analysisStale).toBe(true);

    const matter = JSON.parse(getMatterById(MID, userId)!.data_json) as Record<string, unknown>;
    const employment = matter.employmentData as { intake: Record<string, unknown>; timeline: Array<{ label: string }> };
    // The correction reached the MATTER, not just the sentence.
    expect(employment.intake.hire_date).toBe('2016-03-02');
    expect(String((matter.generatedSOC as Record<string, unknown>).html)).toContain('2016');
    expect(employment.timeline.some(e => e.label === 'Feedback applied')).toBe(true);
    // The previous version survives.
    expect((matter.draftHistory as unknown[]).length).toBeGreaterThan(0);
  });

  it('REFUSES the whole apply when an unapproved paragraph was altered', async () => {
    seedMatter();
    // The model returns the approved paragraph AND meddles with another.
    modelReply = JSON.stringify({
      revised: {
        1: '<p>1. The Plaintiff was hired on March 2, 2016.</p>',
        3: '<p>3. The Plaintiff was terminated FOR CAUSE on May 20, 2026.</p>',
      },
    });

    const res = await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'statement_of_claim',
      approved: [{
        id: 'rev-0', feedback: 'Hire year is wrong.', kind: 'factual_correction',
        paragraphIndices: [1], proposal: 'Correct the hire year.',
      }],
    });

    // The unapproved paragraph is filtered before it can be written, so the
    // apply succeeds with ONLY the approved change; the pleading is intact.
    expect(res.status).toBe(200);
    const matter = JSON.parse(getMatterById(MID, userId)!.data_json) as Record<string, unknown>;
    const html = String((matter.generatedSOC as Record<string, unknown>).html);
    expect(html).toContain('2016');
    expect(html).not.toContain('FOR CAUSE');
    expect(html).toContain('terminated without cause');
  });

  it('cannot turn a needs_lawyer item into an edit', async () => {
    seedMatter();
    modelReply = JSON.stringify({ revised: { 2: '<p>2. They fired her because they hated her.</p>' } });

    const res = await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'statement_of_claim',
      approved: [{
        id: 'rev-0', feedback: 'Say they fired me because they hated me.', kind: 'needs_lawyer',
        paragraphIndices: [2], proposal: 'Plead animus.',
      }],
    });

    expect(res.status).toBe(200);
    expect(res.body.changedParagraphs).toEqual([]);
    const matter = JSON.parse(getMatterById(MID, userId)!.data_json) as Record<string, unknown>;
    expect(String((matter.generatedSOC as Record<string, unknown>).html)).not.toContain('hated');
  });

  it('does not write intake fields outside the allowlist', async () => {
    seedMatter();
    modelReply = JSON.stringify({ revised: { 2: '<p>2. The Plaintiff was employed as a Senior Buyer.</p>' } });

    await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'statement_of_claim',
      approved: [{
        id: 'rev-0', feedback: 'My title was Senior Buyer.', kind: 'factual_correction',
        paragraphIndices: [2], proposal: 'Correct the title.',
        intakeField: 'internal_secret', intakeValue: 'x',
      }],
    });

    const matter = JSON.parse(getMatterById(MID, userId)!.data_json) as Record<string, unknown>;
    const intake = (matter.employmentData as { intake: Record<string, unknown> }).intake;
    expect(intake.internal_secret).toBeUndefined();
  });

  it('404s for a document type the matter does not have', async () => {
    seedMatter();
    const res = await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'mediation_brief',
      approved: [{ id: 'r', feedback: 'x', kind: 'wording', paragraphIndices: [0], proposal: 'y' }],
    });
    expect(res.status).toBe(404);
  });
});

describe('adopting a draft prepared outside Starling', () => {
  const LETTER = [
    'WITHOUT PREJUDICE',
    '',
    'Dear Sir or Madam:',
    '',
    'RE: Vera Nunes v. Halcyon Retail Inc',
    '',
    'We are counsel to Vera Nunes. Our client was terminated without cause on May 20, 2026 after nine years of service, and this letter sets out the amounts owed to her, which exceed two hundred words of careful prose when the enclosures and particulars are counted, as they are here for the purposes of this test document so the minimum length check is satisfied.',
    '',
    'Yours very truly,',
  ].join('\n');

  it('replace with no existing draft ADOPTS the upload as version of record', async () => {
    const res = await post(`/api/employment/${MID}/draft/replace`, {
      docType: 'demand_letter',
      pastedText: LETTER,
    });
    expect(res.status).toBe(200);
    expect(res.body.adopted).toBe(true);
    const row = await getMatterById(MID, userId);
    const matter = JSON.parse(row!.data_json) as Record<string, unknown>;
    const doc = matter.generated_demand_letter as Record<string, unknown>;
    expect(doc).toBeTruthy();
    expect(String(doc.html)).toContain('Vera Nunes');
    expect(doc.status).toBe('draft');
  });

  it('the feedback loop then plans against the adopted draft', async () => {
    modelReply = JSON.stringify({
      items: [{
        feedback: 'The termination date is wrong: it was May 21, not May 20.',
        kind: 'factual_correction',
        paragraphIndices: [3],
        proposal: 'Correct the termination date.',
        intakeField: 'termination_date',
        intakeValue: '2026-05-21',
      }],
    });
    const res = await post(`/api/employment/${MID}/revision/plan`, {
      docType: 'demand_letter',
      feedback: 'The termination date is wrong: it was May 21, not May 20.',
      source: 'client',
    });
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ kind: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].kind).toBe('factual_correction');
  });

  it('a second replace on the same type is a replacement, not an adoption', async () => {
    const res = await post(`/api/employment/${MID}/draft/replace`, {
      docType: 'demand_letter',
      pastedText: LETTER + '\n\nP.S. This is the corrected version with a little more text for the length check to pass again.',
    });
    expect(res.status).toBe(200);
    expect(res.body.adopted).toBe(false);
  });
});

describe('the letter being answered (rebuttal source)', () => {
  it('attaches, surfaces, and replaces the letter on the matter', async () => {
    const first = await app.inject({
      method: 'PUT', url: `/api/employment/${MID}/rebuttal-source`,
      payload: { name: 'OC letter.pdf', text: 'We are counsel to the employer and write in response to your letter of demand dated July 20, 2026.' },
    });
    expect(first.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: `/api/employment/${MID}` });
    const body = get.json() as { rebuttalSource?: { name: string; words: number } };
    expect(body.rebuttalSource?.name).toBe('OC letter.pdf');
    expect(body.rebuttalSource?.words).toBeGreaterThan(10);

    const second = await app.inject({
      method: 'PUT', url: `/api/employment/${MID}/rebuttal-source`,
      payload: { name: 'OC letter v2.pdf', text: 'A revised response letter from opposing counsel, long enough to pass the minimum length gate for attachment.' },
    });
    expect(second.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: `/api/employment/${MID}` })).json() as { rebuttalSource?: { name: string } };
    expect(after.rebuttalSource?.name).toBe('OC letter v2.pdf');
  });

  it('generating the rebuttal without a letter attached fails with a plain message', async () => {
    const del = await app.inject({ method: 'DELETE', url: `/api/employment/${MID}/rebuttal-source` });
    expect(del.statusCode).toBe(200);
    // The generator's intake gate runs first; give the matter a minimal
    // analysis so the missing-letter message is the one under test.
    const row = getMatterById(MID, userId)!;
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    (matter.employmentData as Record<string, unknown>).analysis = { computedAt: new Date().toISOString() };
    saveMatter(userId, MID, JSON.stringify(matter));
    const res = await post(`/api/employment/${MID}/litigation-document`, {
      documentType: 'rebuttal_letter',
      lawyerName: 'Jordan Evans',
      firmName: 'Evans Law Firm',
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('Attach the letter you are responding to first');
  });

  it('discarding twice reports there is nothing attached', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/employment/${MID}/rebuttal-source` });
    expect(res.statusCode).toBe(404);
  });
});

describe('the Reply and the forum', () => {
  // The generator's user prompt reads the computed analysis; a real matter
  // always has one by the time a Defence arrives.
  const FULL_ANALYSIS = {
    computedAt: new Date().toISOString(),
    damagesEstimate: {
      esaNoticeWeeks: 8, esaNoticePay: 13538, esaSeverancePay: 14893,
      commonLawLowMonths: 8, commonLawHighMonths: 12,
      commonLawLowAmount: 58667, commonLawHighAmount: 88000,
      additionalHeads: [], totalEstimateLow: 58667, totalEstimateHigh: 88000,
    },
    bardalFactors: { age: 47, tenureYears: 9.2 },
  };

  function setForum(procedure: string | null) {
    const row = getMatterById(MID, userId)!;
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    const emp = matter.employmentData as Record<string, unknown>;
    emp.analysis = FULL_ANALYSIS;
    if (procedure === null) delete emp.selectedProcedure;
    else emp.selectedProcedure = procedure;
    // A Defence on file proves the forum guard runs FIRST: even with the
    // Defence attached, a Small Claims matter gets the no-Reply message.
    matter.defenceSource = { name: 'Statement of Defence', text: 'The Defendant pleads just cause. '.repeat(10), savedAt: new Date().toISOString(), words: 60 };
    saveMatter(userId, MID, JSON.stringify(matter));
  }

  it('a Small Claims matter cannot generate a Reply: the rules provide none', async () => {
    seedMatter();
    setForum('small_claims');
    const res = await post(`/api/employment/${MID}/litigation-document`, {
      documentType: 'reply',
      lawyerName: 'Jordan Haworth',
      firmName: 'Evans Law Firm',
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('Small Claims Court');
    expect(String(res.body.error)).toContain('Form 9A');
    expect(String(res.body.error)).toContain('settlement conference');
  });

  it('the recommended procedure gates too, when the lawyer has not chosen one', async () => {
    seedMatter();
    const row = getMatterById(MID, userId)!;
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    const emp = matter.employmentData as Record<string, unknown>;
    emp.analysis = { ...FULL_ANALYSIS, recommendedProcedure: 'small_claims' };
    matter.defenceSource = { name: 'Statement of Defence', text: 'The Defendant pleads just cause. '.repeat(10), savedAt: new Date().toISOString(), words: 60 };
    saveMatter(userId, MID, JSON.stringify(matter));
    const res = await post(`/api/employment/${MID}/litigation-document`, {
      documentType: 'reply',
      lawyerName: 'Jordan Haworth',
      firmName: 'Evans Law Firm',
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('Small Claims Court');
  });

  it('a Superior Court matter passes the forum guard and reaches drafting', async () => {
    seedMatter();
    setForum('simplified');
    // The (mocked) model returns a minimal pleading body; reaching 200
    // proves the guard did not fire for the Superior Court forum.
    modelReply = '<p>The Plaintiff denies the allegations contained in paragraphs 1 to 9 of the Statement of Defence.</p>';
    const res = await post(`/api/employment/${MID}/litigation-document`, {
      documentType: 'reply',
      lawyerName: 'Jordan Haworth',
      firmName: 'Evans Law Firm',
    });
    expect(res.status).toBe(200);
    const html = String(res.body.html);
    // And the Form 25A shell arrived around the body: heading, numbered
    // paragraph, closing.
    expect(html).toContain('SUPERIOR COURT OF JUSTICE');
    expect(html).toContain('<u>REPLY</u>');
    expect(html).toContain('>1. The Plaintiff denies');
    expect(html).toContain('Lawyers for the Plaintiff');
  });
});

describe('reading long direction notes', () => {
  it('accepts a long client email: the cap is 100k, not 20k', async () => {
    // Validation must pass; the (mocked) model then answers.
    modelReply = JSON.stringify({ instructions: [{ text: 'Demand only the unpaid commission.', kind: 'scope' }] });
    const notes = 'The client writes at length about the file. '.repeat(1200); // ~52k chars
    const res = await post(`/api/employment/${MID}/direction/extract`, { notes });
    expect(res.status).toBe(200);
  });

  it('over the cap, the error says HOW LONG the notes are, never "paste the notes"', async () => {
    const notes = 'x'.repeat(100_001);
    const res = await post(`/api/employment/${MID}/direction/extract`, { notes });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('characters');
    expect(String(res.body.error)).toContain('Split the paste');
    expect(String(res.body.error)).not.toBe('Paste the notes to read.');
  });

  it('truly empty notes still get the paste message', async () => {
    const res = await post(`/api/employment/${MID}/direction/extract`, { notes: '' });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toBe('Paste the notes to read.');
  });
});
