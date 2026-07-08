/**
 * House style enforcement for generated documents — deterministic, applied
 * after every model call rather than requested from the model.
 *
 * Rule: no em dashes in generated content. An em dash between spaces reads
 * as a comma; any remainder becomes a hyphen. Prompts still instruct
 * against them; this guarantees the rule regardless of model behaviour.
 */

export function enforceHouseStyle(html: string): string {
  return html.replace(/\s—\s/g, ', ').replace(/—/g, '-');
}
