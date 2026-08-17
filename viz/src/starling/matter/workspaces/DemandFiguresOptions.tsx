// Demand-letter "figures in the letter" options: recipient, the editable heads
// of damage, amounts already paid, and mitigation earnings. Extracted verbatim
// from MatterDetailView.tsx's draft tab; state stays in the parent (Option A).

import { navy, orange, border, ink, muted, sans } from '../tokens.js';

type Head = { label: string; basis: string; amount: string };
type Paid = { label: string; amount: string };

export function DemandFiguresOptions({
  dlRecipient, setDlRecipient,
  dlHeads, setDlHeads, dlHeadsTouched, setDlHeadsTouched,
  dlPaid, setDlPaid, dlMitigation, setDlMitigation,
  genDemandAmount, setGenDemandAmount, refreshEmployment,
}: {
  dlRecipient: string;
  setDlRecipient: React.Dispatch<React.SetStateAction<string>>;
  dlHeads: Head[];
  setDlHeads: React.Dispatch<React.SetStateAction<Head[]>>;
  dlHeadsTouched: boolean;
  setDlHeadsTouched: React.Dispatch<React.SetStateAction<boolean>>;
  dlPaid: Paid[];
  setDlPaid: React.Dispatch<React.SetStateAction<Paid[]>>;
  dlMitigation: string;
  setDlMitigation: React.Dispatch<React.SetStateAction<string>>;
  genDemandAmount: string;
  setGenDemandAmount: React.Dispatch<React.SetStateAction<string>>;
  refreshEmployment: () => void;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>The figures in the letter</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 12, lineHeight: 1.5 }}>
        Starling builds the itemised damages table from the analysis rather than writing the numbers into prose. Enter what the employer has already paid and what your client has earned since, and the table nets them off.
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Addressed to</div>
        <input
          type="text"
          placeholder="Opposing counsel, or the employer where counsel is unknown"
          value={dlRecipient}
          onChange={e => setDlRecipient(e.target.value)}
          aria-label="Recipient of the demand letter"
          style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
        />
        <div style={{ fontSize: 11.5, color: muted, marginTop: 4 }}>Left blank, the letter is marked for you to complete rather than addressed to a guess.</div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
          <div style={{ fontSize: 12.5, color: muted, fontWeight: 600 }}>Heads of damage claimed</div>
          {dlHeadsTouched && (
            <button
              onClick={() => { setDlHeadsTouched(false); refreshEmployment(); }}
              style={{ fontSize: 12, color: orange, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontFamily: sans }}
            >
              reset to the analysis
            </button>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: muted, marginBottom: 7, lineHeight: 1.5 }}>
          Prefilled from the analysis. Edit the wording, the basis or the figure and the table says what you wrote. A head left without an amount is shown as one for you to quantify, not dropped.
        </div>
        {dlHeads.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input
                type="text"
                placeholder="Head, e.g. Pay in lieu of reasonable notice"
                value={row.label}
                onChange={e => { setDlHeadsTouched(true); setDlHeads(rows => rows.map((r, j) => j === i ? { ...r, label: e.target.value } : r)); }}
                aria-label={`Head of damage ${i + 1}`}
                style={{ fontFamily: sans, fontSize: 13.5, padding: '9px 11px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
              />
              <input
                type="text"
                placeholder="Basis, e.g. eight to twelve months at the plaintiff's compensation"
                value={row.basis}
                onChange={e => { setDlHeadsTouched(true); setDlHeads(rows => rows.map((r, j) => j === i ? { ...r, basis: e.target.value } : r)); }}
                aria-label={`Basis for head ${i + 1}`}
                style={{ fontFamily: sans, fontSize: 12.5, padding: '8px 11px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: muted, boxSizing: 'border-box' }}
              />
            </div>
            <input
              type="text"
              placeholder="Amount"
              value={row.amount}
              onChange={e => { setDlHeadsTouched(true); setDlHeads(rows => rows.map((r, j) => j === i ? { ...r, amount: e.target.value.replace(/[^\d]/g, '') } : r)); }}
              aria-label={`Amount for head ${i + 1}`}
              style={{ width: 120, fontFamily: sans, fontSize: 13.5, padding: '9px 11px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
            />
            <button
              onClick={() => { setDlHeadsTouched(true); setDlHeads(rows => rows.filter((_, j) => j !== i)); }}
              aria-label={`Remove head ${i + 1}`}
              style={{ fontSize: 12, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '9px 4px 0' }}
            >
              remove
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 2 }}>
          <button
            onClick={() => { setDlHeadsTouched(true); setDlHeads(rows => [...rows, { label: '', basis: '', amount: '' }]); }}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
          >
            Add a head
          </button>
          {dlHeads.length > 0 && (() => {
            const gross = dlHeads.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            // The shortcut and the label reflect the NET the letter's table
            // actually claims: gross less what has been paid and earned in
            // mitigation. Filling the demand with the gross while the table nets
            // those off made the letterhead figure argue with its body.
            const paidTotal = dlPaid.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            const mitig = Number(dlMitigation) || 0;
            const net = Math.max(0, gross - paidTotal - mitig);
            const deducted = paidTotal + mitig > 0;
            const asCad = net.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
            return (
              <span style={{ fontSize: 12, color: muted }}>
                {deducted ? 'Net claim' : 'Subtotal'} {asCad}
                {/* The demand is a judgment call, so it is never filled in
                    silently. Offered, once, when the figures are on screen and
                    the field is empty. */}
                {net > 0 && !genDemandAmount && (
                  <button
                    onClick={() => setGenDemandAmount(String(Math.round(net)))}
                    style={{ marginLeft: 8, fontSize: 12, color: orange, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontFamily: sans }}
                  >
                    demand this amount
                  </button>
                )}
              </span>
            );
          })()}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Already paid by the employer</div>
        {dlPaid.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              type="text"
              placeholder="e.g., ESA notice and severance"
              value={row.label}
              onChange={e => setDlPaid(rows => rows.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
              aria-label={`Payment ${i + 1} description`}
              style={{ flex: 1, fontFamily: sans, fontSize: 13.5, padding: '9px 11px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
            />
            <input
              type="text"
              placeholder="Amount"
              value={row.amount}
              onChange={e => setDlPaid(rows => rows.map((r, j) => j === i ? { ...r, amount: e.target.value.replace(/[^\d]/g, '') } : r))}
              aria-label={`Payment ${i + 1} amount`}
              style={{ width: 120, fontFamily: sans, fontSize: 13.5, padding: '9px 11px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
            />
            <button
              onClick={() => setDlPaid(rows => rows.filter((_, j) => j !== i))}
              aria-label={`Remove payment ${i + 1}`}
              style={{ fontSize: 12, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '0 4px' }}
            >
              remove
            </button>
          </div>
        ))}
        <button
          onClick={() => setDlPaid(rows => [...rows, { label: '', amount: '' }])}
          style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
        >
          Add a payment
        </button>
      </div>

      <div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Mitigation earnings to date (CAD)</div>
        <input
          type="text"
          placeholder="Leave blank if none"
          value={dlMitigation}
          onChange={e => setDlMitigation(e.target.value.replace(/[^\d]/g, ''))}
          aria-label="Mitigation earnings to date"
          style={{ width: 200, fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}
