/**
 * ExtractionReviewPanel — the human gate of the extraction apply loop.
 *
 * Shows every extracted field beside the matter's CURRENT intake value with
 * the model's confidence and, when quote grounding ran, the verbatim source
 * sentence and its verified mark. Blank-intake fields come pre-checked;
 * replacing an existing value requires ticking that field's own "replace"
 * box. Nothing is written until the lawyer clicks Apply, and the result
 * summary reports exactly what changed, what was skipped, and which dated
 * events moved (the consequence diff).
 *
 * See docs/specs/document-extraction-apply-2026-07.md (Phase 1 slice 2).
 */

import { useState, useMemo } from 'react';
import type { DocumentExtraction, ApplyExtractionResult } from './hooks/useStarlingApi.js';

const navy = '#0f1a2e';
const green = '#16a34a';
const amber = '#d97706';
const red = '#dc2626';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const sans = "system-ui, -apple-system, sans-serif";

interface Props {
  extraction: DocumentExtraction;
  /** The matter's current intake values (for the side-by-side + blank detection). */
  intake: Record<string, unknown>;
  onApply: (extractionId: string, fields: string[], overwrite: string[]) => Promise<ApplyExtractionResult>;
  /** Called when the lawyer dismisses the result summary (parent refreshes the matter). */
  onDone?: () => void;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function fmt(v: unknown): string {
  if (isBlank(v)) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

export function ExtractionReviewPanel({ extraction, intake, onApply, onDone }: Props) {
  const extractionId = extraction.id ?? 'idx-0';
  const rows = useMemo(() =>
    Object.entries(extraction.extractedFields)
      .filter(([, f]) => f && !isBlank(f.value)),
  [extraction.extractedFields]);

  const [checked, setChecked] = useState<Set<string>>(() =>
    new Set(rows.filter(([k]) => isBlank(intake[k])).map(([k]) => k)));
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyExtractionResult | null>(null);
  const [quoteOpen, setQuoteOpen] = useState<string | null>(null);

  const alreadyApplied = Boolean(extraction.appliedAt);

  const toggle = (set: Set<string>, key: string, updater: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    updater(next);
  };

  const apply = async () => {
    setBusy(true);
    try {
      const res = await onApply(extractionId, [...checked], [...overwrite]);
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return null;

  const applyCount = [...checked].filter(k => isBlank(intake[k]) || overwrite.has(k)).length;

  return (
    <div style={{ fontFamily: sans, marginTop: 12, border: `1px solid ${border}`, background: '#fff' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}`, fontSize: 13, color: muted }}>
        Review each fact against the file, then apply the ones you accept. Nothing changes without your click.
        {alreadyApplied && (
          <span style={{ marginLeft: 8, color: green, fontWeight: 700 }}>
            Applied {extraction.appliedFields?.length ?? 0} field{(extraction.appliedFields?.length ?? 0) === 1 ? '' : 's'} previously.
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: muted, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '8px 10px 8px 14px' }}>Apply</th>
              <th style={{ padding: '8px 10px' }}>Field</th>
              <th style={{ padding: '8px 10px' }}>Extracted value</th>
              <th style={{ padding: '8px 10px' }}>Source</th>
              <th style={{ padding: '8px 10px' }}>Current value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, f]) => {
              const current = intake[name];
              const blank = isBlank(current);
              const confColour = f.confidence === 'high' ? green : f.confidence === 'medium' ? amber : muted;
              return (
                <tr key={name} style={{ borderTop: `1px solid ${border}` }}>
                  <td style={{ padding: '8px 10px 8px 14px', verticalAlign: 'top' }}>
                    <input
                      type="checkbox"
                      checked={checked.has(name)}
                      onChange={() => toggle(checked, name, setChecked)}
                      aria-label={`Apply ${name.replace(/_/g, ' ')}`}
                      style={{ accentColor: navy }}
                    />
                  </td>
                  <td style={{ padding: '8px 10px', verticalAlign: 'top', fontWeight: 600, color: ink, whiteSpace: 'nowrap' }}>
                    {name.replace(/_/g, ' ')}
                  </td>
                  <td style={{ padding: '8px 10px', verticalAlign: 'top', color: ink, maxWidth: 260, overflowWrap: 'break-word' }}>
                    {fmt(f.value)}
                    <span style={{
                      marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 2,
                      background: f.confidence === 'high' ? '#e7f6ec' : f.confidence === 'medium' ? '#fdf0dd' : '#f4f1ec',
                      color: confColour,
                    }}>
                      {f.confidence}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', verticalAlign: 'top', maxWidth: 220 }}>
                    {f.sourceQuote ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setQuoteOpen(quoteOpen === name ? null : name)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: f.verified ? green : red, fontWeight: 600 }}
                          aria-label={f.verified ? `Verified in document: ${name.replace(/_/g, ' ')}` : `Not verified in document: ${name.replace(/_/g, ' ')}`}
                        >
                          {f.verified ? '✓ verified in document' : '⚠ not found in document'}
                        </button>
                        {quoteOpen === name && (
                          <div style={{ marginTop: 4, fontSize: 12, color: muted, fontStyle: 'italic', borderLeft: `2px solid ${border}`, paddingLeft: 8 }}>
                            "{f.sourceQuote}"
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: muted }}>no quote</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', verticalAlign: 'top', color: blank ? muted : ink, maxWidth: 220, overflowWrap: 'break-word' }}>
                    {blank ? <em style={{ color: muted }}>blank</em> : fmt(current)}
                    {!blank && checked.has(name) && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: 12, color: red, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={overwrite.has(name)}
                          onChange={() => toggle(overwrite, name, setOverwrite)}
                          aria-label={`Replace current value of ${name.replace(/_/g, ' ')}`}
                          style={{ accentColor: red }}
                        />
                        replace current value
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '10px 14px', borderTop: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy || applyCount === 0 || Boolean(result?.ok)}
          onClick={() => { void apply(); }}
          style={{
            background: applyCount > 0 && !result?.ok ? navy : '#9aa2ad', color: '#fff', fontSize: 13.5, fontWeight: 600,
            padding: '8px 16px', borderRadius: 2, border: 'none', cursor: applyCount > 0 && !result?.ok ? 'pointer' : 'default',
          }}
        >
          {busy ? 'Applying…' : result?.ok ? 'Applied' : `Apply ${applyCount} field${applyCount === 1 ? '' : 's'} to the intake`}
        </button>
        <span style={{ fontSize: 12, color: muted }}>
          Blank fields fill in; a checked field with an existing value changes only when its "replace" box is also ticked.
        </span>
      </div>

      {result && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${border}`, fontSize: 13 }} role="status">
          {result.ok ? (
            <>
              <div style={{ color: green, fontWeight: 600 }}>
                Applied {(result.applied?.length ?? 0) + (result.overwritten?.length ?? 0)} field{((result.applied?.length ?? 0) + (result.overwritten?.length ?? 0)) === 1 ? '' : 's'} to the intake.
                {(result.overwritten?.length ?? 0) > 0 && ` Replaced: ${result.overwritten!.join(', ')}.`}
              </div>
              {(result.skippedNotBlank?.length ?? 0) > 0 && (
                <div style={{ color: muted, marginTop: 3 }}>Kept your existing values for: {result.skippedNotBlank!.join(', ')}.</div>
              )}
              {(result.unmapped?.length ?? 0) > 0 && (
                <div style={{ color: muted, marginTop: 3 }}>For reference only (no intake field): {result.unmapped!.join(', ')}.</div>
              )}
              {(result.timelineDiff?.added.length ?? 0) > 0 && (
                <div style={{ color: amber, marginTop: 3 }}>
                  Dates now on the docket: {result.timelineDiff!.added.map(d => `${d.label} (${d.date})`).join('; ')}.
                </div>
              )}
              {result.analysisStale && (
                <div style={{ color: amber, marginTop: 3 }}>
                  These facts feed the damages analysis — re-run it from the Issues tab so figures match.
                </div>
              )}
              <button
                type="button"
                onClick={() => onDone?.()}
                style={{ marginTop: 8, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, background: navy, color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}
              >
                Done
              </button>
            </>
          ) : (
            <div style={{ color: red }}>
              {result.error ?? 'The fields could not be applied.'}
              {(result.invalidFields?.length ?? 0) > 0 && ` Fields: ${result.invalidFields!.join(', ')}.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
