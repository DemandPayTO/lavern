// The editable list of legal issues on the file. The analysis raises issues
// and the lawyer approves them above; this lets the lawyer correct that list
// directly: remove an issue that is wrong, and add one the analysis never
// raised (a claim to plead in the alternative, or one the facts understate).
// Every issue here is a real gate issue, so approving it drives the factum and
// pleading selection exactly as an analysis-raised issue does.

import { useEffect, useState } from 'react';
import { navy, orange, green, muted, border, ink, serif, sans } from '../tokens.js';

type CatalogGate = { gate: string; gateName: string; issues: Array<{ code: string; label: string }> };

export function ApprovedIssuesEditor({
  approvedIssues, dismissedIssues, raisedCodes, setIssues,
}: {
  approvedIssues: string[];
  dismissedIssues: string[];
  /** Codes the analysis raised (issue codes of the triggered gates). */
  raisedCodes: string[];
  setIssues: (approved: string[], dismissed: string[]) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogGate[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch('/api/employment/issue-catalog', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setCatalog(d.catalog ?? []); })
      .catch(() => { /* the editor still works from the approved codes alone */ });
  }, []);

  const labelFor = (code: string): { label: string; gateName: string } => {
    for (const g of catalog) {
      const hit = g.issues.find(i => i.code === code);
      if (hit) return { label: hit.label, gateName: g.gateName };
    }
    return { label: code.replace(/_/g, ' '), gateName: '' };
  };

  const raised = new Set(raisedCodes);
  const approvedSet = new Set(approvedIssues);

  const remove = (code: string) => {
    setIssues(approvedIssues.filter(c => c !== code), dismissedIssues);
  };
  const add = (code: string) => {
    if (approvedSet.has(code)) return;
    setIssues([...approvedIssues, code], dismissedIssues.filter(c => c !== code));
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginBottom: 18 }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        Issues on this file
      </div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 12, lineHeight: 1.5 }}>
        The issues your documents argue. Remove one that does not belong, or add one the analysis did not raise. This is the list the factum outline and the pleadings are built from.
      </div>

      {approvedIssues.length === 0 ? (
        <div style={{ fontSize: 13, color: muted, padding: '4px 0 12px' }}>
          No issues are on the file yet. Approve the ones the analysis raised above, or add one below.
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {approvedIssues.map(code => {
            const { label, gateName } = labelFor(code);
            return (
              <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: `1px solid #f0ede8` }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: green, flex: '0 0 auto' }} />
                <span style={{ flex: 1, fontSize: 13, color: ink }}>
                  {label}
                  {gateName && <span style={{ color: muted, fontSize: 11.5 }}> · {gateName}</span>}
                  {!raised.has(code) && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: navy, background: '#eef1f6', padding: '1px 6px', borderRadius: 2 }}>ADDED BY YOU</span>}
                </span>
                <button
                  onClick={() => remove(code)}
                  aria-label={`Remove ${label}`}
                  style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '3px 4px' }}
                >
                  remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${border}`, paddingTop: 10 }}>
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
          >
            Add an issue the analysis did not raise
          </button>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
              Add a claim the facts support but the analysis did not surface, or one to plead in the alternative. Adding it puts it on the file and includes it in the documents you generate.
            </div>
            {catalog.map(g => {
              const addable = g.issues.filter(i => !approvedSet.has(i.code));
              if (addable.length === 0) return null;
              return (
                <div key={g.gate} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: muted, letterSpacing: 0.3, marginBottom: 4 }}>{g.gateName.toUpperCase()}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {addable.map(i => (
                      <button
                        key={i.code}
                        onClick={() => add(i.code)}
                        style={{ fontSize: 12, fontFamily: sans, background: '#fbfaf7', border: `1px solid ${border}`, color: ink, cursor: 'pointer', padding: '5px 10px', borderRadius: 2 }}
                      >
                        + {i.label}{raised.has(i.code) && <span style={{ color: orange, marginLeft: 5 }}>· raised by analysis</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <button
              onClick={() => setAdding(false)}
              style={{ fontSize: 12, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer', marginTop: 4 }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
