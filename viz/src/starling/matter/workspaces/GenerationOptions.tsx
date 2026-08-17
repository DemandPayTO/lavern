// The per-document generation fields for non-court-form drafts: tone, demand
// amount and response deadline (demand letter); procedure and court location
// (SOC); and the claim amount for everything else. Extracted verbatim from
// MatterDetailView.tsx's draft tab (Option A).

import { border, ink, muted, sans } from '../tokens.js';

export function GenerationOptions({
  selectedDraft,
  genTone, setGenTone, genDemandAmount, setGenDemandAmount,
  dlDeadlineDays, setDlDeadlineDays,
  genProcedure, setGenProcedure, genCourtLocation, setGenCourtLocation,
  amountPrefilled, setAmountPrefilled,
}: {
  selectedDraft: string;
  genTone: string;
  setGenTone: React.Dispatch<React.SetStateAction<string>>;
  genDemandAmount: string;
  setGenDemandAmount: React.Dispatch<React.SetStateAction<string>>;
  dlDeadlineDays: number;
  setDlDeadlineDays: React.Dispatch<React.SetStateAction<number>>;
  genProcedure: string;
  setGenProcedure: React.Dispatch<React.SetStateAction<string>>;
  genCourtLocation: string;
  setGenCourtLocation: React.Dispatch<React.SetStateAction<string>>;
  amountPrefilled: boolean;
  setAmountPrefilled: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14, marginTop: 8 }}>
      {(selectedDraft === 'demand') && (
        <>
          <div>
            <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Tone</div>
            <select value={genTone} onChange={e => setGenTone(e.target.value)} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}>
              <option value="professional">Professional</option>
              <option value="firm">Firm</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <div>
            <label htmlFor="dl-amount" style={{ display: 'block', fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Demand Amount (CAD)</label>
            <input id="dl-amount" type="text" placeholder="e.g., 150000" value={genDemandAmount} onChange={e => setGenDemandAmount(e.target.value.replace(/[^\d]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
          </div>
          <div>
            <label htmlFor="dl-deadline" style={{ display: 'block', fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Response deadline (days)</label>
            <input id="dl-deadline" type="number" min={1} max={90} value={dlDeadlineDays} onChange={e => setDlDeadlineDays(Math.min(90, Math.max(1, Number(e.target.value) || 14)))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
            <div style={{ fontSize: 11.5, color: muted, marginTop: 3 }}>The letter states the calendar date, and it goes on your docket.</div>
          </div>
        </>
      )}
      {(selectedDraft === 'soc') && (
        <>
          <div>
            <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Procedure Type</div>
            <select value={genProcedure} onChange={e => setGenProcedure(e.target.value)} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}>
              <option value="small_claims">Small Claims (≤$50K)</option>
              <option value="simplified">Simplified ($50K–$200K)</option>
              <option value="ordinary">Ordinary (&gt;$200K)</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Court Location</div>
            <input type="text" placeholder="e.g., Toronto" value={genCourtLocation} onChange={e => setGenCourtLocation(e.target.value)} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
          </div>
        </>
      )}
      {selectedDraft !== 'demand' && (
        <div>
          <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Claim Amount (CAD)</div>
          <input type="text" placeholder="e.g., 150000" value={genDemandAmount} onChange={e => { setGenDemandAmount(e.target.value.replace(/[^\d]/g, '')); setAmountPrefilled(false); }} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
          {amountPrefilled && selectedDraft === 'soc' && (
            <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>
              Prefilled from the high end of the damages estimate, rounded up to the nearest $5,000. Your judgment governs; change it freely.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
