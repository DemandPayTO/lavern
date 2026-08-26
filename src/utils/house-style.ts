/**
 * House style enforcement for generated documents — deterministic, applied
 * after every model call rather than requested from the model.
 *
 * Rule: no em dashes in generated content. An em dash between spaces reads
 * as a comma; any remainder becomes a hyphen. Prompts still instruct
 * against them; this guarantees the rule regardless of model behaviour.
 *
 * The entity forms are covered as well as the character, and that is not
 * belt and braces. Generated HTML is sanitised on the way out of the route,
 * and sanitize-html decodes entities: a model that writes "&mdash;" gets past
 * this function untouched and then has its entity turned into a real em dash
 * downstream, after enforcement has already run. Matching only the character
 * left the rule defeated by the one spelling a model is most likely to use in
 * HTML. Caught by the Schedule "A" feature test on a verification pass.
 */

// The character, the named entity, and both numeric forms.
const EM_DASH = '(?:—|&mdash;|&#8212;|&#x2014;)';
const SPACED_EM_DASH = new RegExp(`\\s${EM_DASH}\\s`, 'gi');
const ANY_EM_DASH = new RegExp(EM_DASH, 'gi');

export function enforceHouseStyle(html: string): string {
  return html.replace(SPACED_EM_DASH, ', ').replace(ANY_EM_DASH, '-');
}
