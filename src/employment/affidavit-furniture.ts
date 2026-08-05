/**
 * Affidavit furniture — the parts of every affidavit that never vary, and
 * that carry legal consequence when they are wrong.
 *
 * An affidavit's opening, its knowledge statement, its jurat and its
 * exhibit stamps are fixed forms. A model asked to write them will
 * usually get them right and occasionally not, and "occasionally not" on
 * a jurat means a document a commissioner cannot swear. So they are
 * assembled here, deterministically, and the model writes only the body.
 *
 * THE KNOWLEDGE BASIS IS THE PART THAT MATTERS. Rule 39.01(4) permits an
 * affidavit on an interlocutory motion to rest on information and belief
 * PROVIDED the source is named. On a motion for final relief that
 * latitude falls away and the court may draw an adverse inference from a
 * deponent who could have sworn to personal knowledge and did not. The
 * basis is therefore a structured input, not a phrase the model picks.
 *
 * Deterministic: no model call.
 */

export type DeponentCapacity = 'plaintiff' | 'lawyer' | 'law_clerk' | 'other';
export type KnowledgeBasis = 'personal' | 'information_and_belief' | 'mixed';

export interface AffidavitFurnitureInput {
  deponentName: string;
  /** "of the City of Toronto, in the Province of Ontario" */
  deponentCity?: string;
  capacity: DeponentCapacity;
  capacityDescription?: string;
  knowledgeBasis: KnowledgeBasis;
  /** Named source, required when the affidavit rests on information and belief. */
  informationSource?: string;
  sworn: 'sworn' | 'affirmed';
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CAPACITY_PHRASE: Record<DeponentCapacity, string> = {
  plaintiff: 'the Plaintiff in this action',
  lawyer: 'a lawyer with the firm representing the Plaintiff in this action',
  law_clerk: 'a law clerk employed by the firm representing the Plaintiff in this action',
  other: '',
};

/**
 * The opening block: who is swearing, in what capacity, and on what
 * basis. The knowledge sentence is generated from the structured basis so
 * it cannot drift into something the rule does not permit.
 */
export function buildAffidavitOpening(input: AffidavitFurnitureInput): { preamble: string; numbered: string } {
  const name = esc(input.deponentName || '[LAWYER: deponent name]');
  const city = esc(input.deponentCity || '[LAWYER: city]');
  const capacity = input.capacity === 'other'
    ? esc(input.capacityDescription || '[LAWYER: capacity of the deponent]')
    : CAPACITY_PHRASE[input.capacity];
  const verb = input.sworn === 'affirmed' ? 'AFFIRM AND SAY' : 'MAKE OATH AND SAY';

  const knowledge = (() => {
    switch (input.knowledgeBasis) {
      case 'personal':
        return 'I have personal knowledge of the matters to which I depose in this affidavit.';
      case 'information_and_belief':
        return `Except where I state that I have obtained information from another source, I have personal knowledge of the matters to which I depose. Where I depose to information received from another source, I have identified that source and I believe that information to be true.${
          input.informationSource ? ` My information comes from ${esc(input.informationSource)}.` : ' [LAWYER: name the source of the information.]'
        }`;
      case 'mixed':
      default:
        return 'I have personal knowledge of the matters to which I depose, except where I state that a matter is based on information received from another source, in which case I identify that source and believe the information to be true.';
    }
  })();

  // The "I, NAME ... MAKE OATH AND SAY:" line is the preamble, not
  // paragraph 1. Numbering starts at the capacity paragraph, as every
  // Ontario affidavit does.
  return {
    preamble: `<p>I, <strong>${name}</strong>, of the City of ${city}, in the Province of Ontario, ${verb}:</p>`,
    numbered: [
      `<p>I am ${capacity}, and as such I have knowledge of the matters set out below.</p>`,
      `<p>${knowledge}</p>`,
    ].join('\n'),
  };
}

/**
 * The jurat. A commissioner signs this; its shape is fixed and its blanks
 * are blanks on purpose, because they are completed at the swearing.
 */
export function buildJurat(input: { sworn: 'sworn' | 'affirmed'; deponentName: string }): string {
  const verb = input.sworn === 'affirmed' ? 'AFFIRMED' : 'SWORN';
  const name = esc(input.deponentName || '[LAWYER: deponent name]');
  return [
    '<hr>',
    `<p>${verb} BEFORE ME at the City of _______________, in the Province of Ontario, this ______ day of _______________, 20____.</p>`,
    '<p>_______________________________<br>A Commissioner for Taking Affidavits (or as may be)</p>',
    `<p>_______________________________<br>${name}</p>`,
  ].join('\n');
}

export interface ExhibitInput {
  /** "A", "B", ... assigned in order when omitted. */
  letter?: string;
  description: string;
}

/** Exhibit letters in order: A, B, ... Z, AA, AB. */
export function exhibitLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * The exhibit index and the stamp wording a commissioner endorses on each
 * exhibit. Both are fixed forms; only the descriptions are the lawyer's.
 */
export function buildExhibitBlock(
  exhibits: ExhibitInput[],
  deponentName: string,
  sworn: 'sworn' | 'affirmed',
): { index: string; stamps: string } {
  if (exhibits.length === 0) return { index: '', stamps: '' };
  const rows = exhibits.map((ex, i) => {
    const letter = esc(ex.letter || exhibitLetter(i));
    return `<tr><th>Exhibit "${letter}"</th><td>${esc(ex.description)}</td></tr>`;
  });
  const stampVerb = sworn === 'affirmed' ? 'affirmed' : 'sworn';
  const stamps = exhibits.map((ex, i) => {
    const letter = esc(ex.letter || exhibitLetter(i));
    return `<p>This is Exhibit "${letter}" referred to in the affidavit of ${esc(deponentName || '[LAWYER: deponent name]')}, ${stampVerb} before me this ______ day of _______________, 20____.<br><br>_______________________________<br>A Commissioner for Taking Affidavits (or as may be)</p>`;
  }).join('\n');
  return {
    index: `<h2>Index of Exhibits</h2>\n<table>\n${rows.join('\n')}\n</table>`,
    stamps: `<h2>Exhibit Stamps</h2>\n<p><em>Endorse one of the following on the first page of each exhibit.</em></p>\n${stamps}`,
  };
}


/**
 * Remove a capacity or knowledge paragraph the model wrote itself.
 *
 * Both are supplied deterministically above; a model that writes its own
 * produces a duplicate ("I am a lawyer with the firm..." followed by "I am
 * the solicitor for the plaintiff..."), which reads as carelessness in a
 * sworn document. Only the OPENING run of body paragraphs is examined, so
 * a later paragraph that legitimately describes the deponent's role in
 * events survives.
 */
export function scrubAffidavitBody(bodyHtml: string): string {
  const CAPACITY = /^\s*I am (the|a) (solicitor|lawyer|counsel|law clerk|plaintiff|deponent)\b/i;
  const KNOWLEDGE = /^\s*I (have personal knowledge|make this affidavit (on|from) (personal knowledge|information))/i;
  const blocks = bodyHtml.split(/(?=<p[\s>])/i);
  let stillOpening = true;
  return blocks.filter(block => {
    if (!stillOpening) return true;
    const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return true;
    if (CAPACITY.test(text) || KNOWLEDGE.test(text)) return false;
    stillOpening = false;
    return true;
  }).join('');
}
