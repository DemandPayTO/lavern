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
import { CAUSE_TRIGGER_LABELS } from './shared.js';

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
  onApply: (extractionId: string, fields: string[], overwrite: string[], offers?: Array<{ index: number; date: string }>) => Promise<ApplyExtractionResult>;
  /** Called when the lawyer dismisses the result summary (parent refreshes the matter). */
  onDone?: () => void;
}

const KIND_LABEL: Record<string, string> = {
  offer: 'Offer', counter: 'Counter-offer', demand: 'Demand', acceptance: 'Acceptance', rejection: 'Rejection',
};

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
  const proposedOffers = extraction.offers ?? [];
  // Offers with a verified quote come pre-checked; an unverified proposal
  // needs the lawyer's deliberate tick. Missing dates need supplying.
  const [offerChecked, setOfferChecked] = useState<Set<number>>(() =>
    new Set(proposedOffers.map((o, i) => (o.verified ? i : -1)).filter(i => i >= 0)));
  const [offerDates, setOfferDates] = useState<Record<number, string>>(() =>
    Object.fromEntries(proposedOffers.map((o, i) => [i, o.date ?? ''])));
  const [offerQuoteOpen, setOfferQuoteOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyExtractionResult | null>(null);
  const [quoteOpen, setQuoteOpen] = useState<string | null>(null);

  const alreadyApplied = Boolean(extraction.appliedAt);

  const toggle = (set: Set<string>, key: string, updater: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    updater(next);
  };

  const readyOffers = [...offerChecked].filter(i => /^\d{4}-\d{2}-\d{2}$/.test(offerDates[i] ?? ''));

  const apply = async () => {
    setBusy(true);
    try {
      const res = await onApply(
        extractionId, [...checked], [...overwrite],
        readyOffers.map(i => ({ index: i, date: offerDates[i] })),
      );
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0 && proposedOffers.length === 0) return null;

  const applyCount = [...checked].filter(k => isBlank(intake[k]) || overwrite.has(k)).length;
  const totalCount = applyCount + readyOffers.length;

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
                    {CAUSE_TRIGGER_LABELS[name] && f.value === true && (
                      <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: amber, whiteSpace: 'normal', maxWidth: 180 }}>
                        Approving this makes {CAUSE_TRIGGER_LABELS[name]} pleadable in the claim
                      </span>
                    )}
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

      {proposedOffers.length > 0 && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${border}` }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: navy, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
            Offers to settle found in this document
          </div>
          <div style={{ fontSize: 12.5, color: muted, marginBottom: 8 }}>
            Approved offers go on the Negotiation ledger, which the mediation brief presents as the negotiation history. A missing date must be supplied before an offer can be applied.
          </div>
          {proposedOffers.map((o, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: `1px solid ${border}`, flexWrap: 'wrap' }}>
              <input
                type="checkbox"
                checked={offerChecked.has(i)}
                onChange={() => { const next = new Set(offerChecked); if (next.has(i)) next.delete(i); else next.add(i); setOfferChecked(next); }}
                aria-label={`Apply ${KIND_LABEL[o.kind] ?? o.kind} to the negotiation ledger`}
                style={{ accentColor: navy, marginTop: 3 }}
              />
              <div style={{ flex: 1, minWidth: 240 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: ink }}>
                  {o.party === 'employer' ? 'Employer' : 'Client'} · {KIND_LABEL[o.kind] ?? o.kind}
                  {o.amountCad != null && ` · $${o.amountCad.toLocaleString('en-CA')}`}
                </span>
                {o.terms && <div style={{ fontSize: 12.5, color: muted, marginTop: 2 }}>{o.terms}</div>}
                {o.sourceQuote && (
                  <>
                    <button
                      type="button"
                      onClick={() => setOfferQuoteOpen(offerQuoteOpen === i ? null : i)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: o.verified ? green : red, fontWeight: 600, marginTop: 2 }}
                    >
                      {o.verified ? '✓ verified in document' : '⚠ not found in document'}
                    </button>
                    {offerQuoteOpen === i && (
                      <div style={{ marginTop: 4, fontSize: 12, color: muted, fontStyle: 'italic', borderLeft: `2px solid ${border}`, paddingLeft: 8 }}>
                        "{o.sourceQuote}"
                      </div>
                    )}
                  </>
                )}
              </div>
              <label style={{ fontSize: 12, color: offerChecked.has(i) && !/^\d{4}-\d{2}-\d{2}$/.test(offerDates[i] ?? '') ? red : muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                Date
                <input
                  type="date"
                  value={offerDates[i] ?? ''}
                  onChange={e => setOfferDates(prev => ({ ...prev, [i]: e.target.value }))}
                  aria-label={`Date of ${KIND_LABEL[o.kind] ?? o.kind}`}
                  style={{ fontFamily: sans, fontSize: 12.5, padding: '4px 7px', border: `1px solid ${border}`, borderRadius: 2 }}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '10px 14px', borderTop: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy || totalCount === 0 || Boolean(result?.ok)}
          onClick={() => { void apply(); }}
          style={{
            background: totalCount > 0 && !result?.ok ? navy : '#9aa2ad', color: '#fff', fontSize: 13.5, fontWeight: 600,
            padding: '8px 16px', borderRadius: 2, border: 'none', cursor: totalCount > 0 && !result?.ok ? 'pointer' : 'default',
          }}
        >
          {busy ? 'Applying…'
            : result?.ok ? 'Applied'
            : readyOffers.length > 0 && applyCount > 0 ? `Apply ${applyCount} field${applyCount === 1 ? '' : 's'} and ${readyOffers.length} offer${readyOffers.length === 1 ? '' : 's'}`
            : readyOffers.length > 0 ? `Apply ${readyOffers.length} offer${readyOffers.length === 1 ? '' : 's'} to the ledger`
            : `Apply ${applyCount} field${applyCount === 1 ? '' : 's'} to the intake`}
        </button>
        <span style={{ fontSize: 12, color: muted }}>
          Blank fields fill in; a checked field with an existing value changes only when its "replace" box is also ticked.
        </span>
      </div>

      {result && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${border}`, fontSize: 13 }} role="status">
          {result.ok ? (
            <>
              {((result.applied?.length ?? 0) + (result.overwritten?.length ?? 0)) > 0 && (
                <div style={{ color: green, fontWeight: 600 }}>
                  Applied {(result.applied?.length ?? 0) + (result.overwritten?.length ?? 0)} field{((result.applied?.length ?? 0) + (result.overwritten?.length ?? 0)) === 1 ? '' : 's'} to the intake.
                  {(result.overwritten?.length ?? 0) > 0 && ` Replaced: ${result.overwritten!.join(', ')}.`}
                </div>
              )}
              {(result.appliedOffers?.length ?? 0) > 0 && (
                <div style={{ color: green, marginTop: 3 }}>
                  On the negotiation ledger: {result.appliedOffers!.join('; ')}. The mediation brief presents these as the negotiation history.
                </div>
              )}
              {(result.skippedDuplicateOffers ?? 0) > 0 && (
                <div style={{ color: muted, marginTop: 3 }}>Skipped {result.skippedDuplicateOffers} offer{result.skippedDuplicateOffers === 1 ? '' : 's'} already on the ledger.</div>
              )}
              {(result.skippedNotBlank?.length ?? 0) > 0 && (
                <div style={{ color: muted, marginTop: 3 }}>Kept your existing values for: {result.skippedNotBlank!.join(', ')}.</div>
              )}
              {(result.unmapped?.length ?? 0) > 0 && (
                <div style={{ color: muted, marginTop: 3 }}>For reference only (no intake field): {result.unmapped!.join(', ')}.</div>
              )}
              {(result.causesUnlocked?.length ?? 0) > 0 && (
                <div style={{ fontSize: 12.5, color: '#b8860b', fontWeight: 600, marginTop: 6 }}>
                  Approving these made pleadable in the claim: {result.causesUnlocked!.join('; ')}. The pleading picker on the Statement of Claim shows each one.
                </div>
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
