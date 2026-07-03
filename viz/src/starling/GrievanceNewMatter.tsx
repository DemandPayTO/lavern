/**
 * GrievanceNewMatter — union-side grievance intake form, rendered by
 * NewMatterView when the practice area toggle is set to "Union Grievance".
 *
 * Captures the fields that drive the deterministic labour gates and the
 * CA deadline clocks. Everything is optional — the CA time limits can be
 * auto-filled later by uploading the collective agreement on the matter.
 */

import { useState, useCallback, useMemo } from 'react';
import { useGrievanceCreate } from './hooks/useLabourApi.js';
import { navy, orange, cream, border, ink, muted, serif, sans } from './shared.js';

// ── Field styles ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', fontFamily: sans, fontSize: 14, color: ink,
  border: `1px solid ${border}`, borderRadius: 2,
  padding: '11px 13px', background: '#fff', boxSizing: 'border-box',
};

const subLabelStyle: React.CSSProperties = {
  fontWeight: 400, color: muted, fontSize: 12.5, marginBottom: 6,
};

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: navy, marginBottom: 7 }}>
      {children}
      {hint && (
        <span style={{
          fontWeight: 400, color: muted, fontSize: 12, background: cream,
          border: `1px solid ${border}`, padding: '1px 7px', borderRadius: 2, marginLeft: 6,
        }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: ink, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: orange }} />
      {label}
    </label>
  );
}

const GRIEVANCE_TYPE_OPTIONS: Array<[string, string]> = [
  ['discharge', 'Discharge (termination)'],
  ['discipline', 'Discipline (suspension, warning, demotion)'],
  ['policy', 'Policy grievance (employer rule — KVP)'],
  ['interpretation', 'CA interpretation / application'],
  ['group', 'Group grievance'],
  ['human_rights', 'Human rights / accommodation'],
  ['health_safety', 'Health & safety / OHSA'],
  ['other', 'Other'],
];

const DISCIPLINE_OPTIONS: Array<[string, string]> = [
  ['none', 'None'],
  ['verbal_warning', 'Verbal warning'],
  ['written_warning', 'Written warning'],
  ['suspension_unpaid', 'Suspension (unpaid)'],
  ['suspension_paid', 'Suspension (paid)'],
  ['demotion', 'Demotion'],
  ['transfer', 'Transfer'],
  ['discharge', 'Discharge'],
  ['last_chance_agreement', 'Last chance agreement'],
  ['other', 'Other'],
];

const CODE_GROUNDS = [
  'disability', 'sex', 'race', 'colour', 'ancestry', 'place of origin',
  'ethnic origin', 'citizenship', 'creed', 'age', 'family status',
];

// ── Component ───────────────────────────────────────────────────────────

export default function GrievanceNewMatter({ onNav }: { onNav: (hash: string) => void }) {
  const { createGrievance, creating, error } = useGrievanceCreate();

  // Grievor + parties
  const [grievorFirst, setGrievorFirst] = useState('');
  const [grievorLast, setGrievorLast] = useState('');
  const [classification, setClassification] = useState('');
  const [seniorityDate, setSeniorityDate] = useState('');
  const [unionName, setUnionName] = useState('');
  const [unionRep, setUnionRep] = useState('');
  const [employerName, setEmployerName] = useState('');
  const [workplace, setWorkplace] = useState('');

  // Collective agreement
  const [caTitle, setCaTitle] = useState('');
  const [procedureArticle, setProcedureArticle] = useState('');
  const [justCauseArticle, setJustCauseArticle] = useState('');
  const [filingDays, setFilingDays] = useState('');
  const [filingKind, setFilingKind] = useState('working');
  const [referralDays, setReferralDays] = useState('');
  const [referralKind, setReferralKind] = useState('calendar');
  const [limitsMandatory, setLimitsMandatory] = useState(false);

  // Incident
  const [grievanceType, setGrievanceType] = useState('discharge');
  const [incidentDate, setIncidentDate] = useState('');
  const [knowledgeDate, setKnowledgeDate] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [discipline, setDiscipline] = useState('discharge');
  const [disciplineLetterDate, setDisciplineLetterDate] = useState('');
  const [statedGrounds, setStatedGrounds] = useState('');

  // Procedure history
  const [filed, setFiled] = useState(false);
  const [filedDate, setFiledDate] = useState('');
  const [grievanceNumber, setGrievanceNumber] = useState('');
  const [currentStep, setCurrentStep] = useState('');
  const [lastStepResponseDate, setLastStepResponseDate] = useState('');

  // Record & procedure
  const [priorDiscipline, setPriorDiscipline] = useState(false);
  const [priorDetails, setPriorDetails] = useState('');
  const [sunsetMonths, setSunsetMonths] = useState('');
  const [repPresent, setRepPresent] = useState(true);
  const [investigated, setInvestigated] = useState(true);

  // Overlays
  const [discriminatory, setDiscriminatory] = useState(false);
  const [grounds, setGrounds] = useState<string[]>([]);
  const [accommodation, setAccommodation] = useState(false);
  const [accommodationDetails, setAccommodationDetails] = useState('');
  const [ohsaReprisal, setOhsaReprisal] = useState(false);
  const [reprisalDetails, setReprisalDetails] = useState('');
  const [offDuty, setOffDuty] = useState(false);
  const [offDutyDetails, setOffDutyDetails] = useState('');

  // Remedy & DFR
  const [remedy, setRemedy] = useState('');
  const [backPay, setBackPay] = useState('');
  const [dfrConcern, setDfrConcern] = useState(false);
  const [dfrDetails, setDfrDetails] = useState('');

  const toggleGround = useCallback((g: string) => {
    setGrounds(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }, []);

  // Live clock preview — mirrors the server's calendar-day computation so
  // the rep sees the filing deadline before submitting
  const filingPreview = useMemo(() => {
    const start = knowledgeDate || incidentDate;
    const days = parseInt(filingDays, 10);
    if (!start || !days || filed) return null;
    const d = new Date(`${start}T00:00:00`);
    if (isNaN(d.getTime())) return null;
    if (filingKind === 'calendar') {
      d.setDate(d.getDate() + days);
    } else {
      let remaining = days;
      while (remaining > 0) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) remaining--;
      }
    }
    return { date: d.toISOString().slice(0, 10), approximate: filingKind === 'working' };
  }, [knowledgeDate, incidentDate, filingDays, filingKind, filed]);

  const handleSubmit = useCallback(async () => {
    const num = (s: string): number | undefined => {
      const n = parseFloat(s);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const intake: Record<string, unknown> = {
      grievor_first_name: grievorFirst || undefined,
      grievor_last_name: grievorLast || undefined,
      grievor_classification: classification || undefined,
      grievor_seniority_date: seniorityDate || undefined,
      union_name: unionName || undefined,
      union_rep_name: unionRep || undefined,
      employer_name: employerName || undefined,
      workplace_location: workplace || undefined,
      ca_title: caTitle || undefined,
      grievance_procedure_article: procedureArticle || undefined,
      just_cause_article: justCauseArticle || undefined,
      filing_deadline_days: num(filingDays),
      filing_deadline_kind: num(filingDays) ? filingKind : undefined,
      referral_deadline_days: num(referralDays),
      referral_deadline_kind: num(referralDays) ? referralKind : undefined,
      time_limits_mandatory: limitsMandatory || undefined,
      grievance_type: grievanceType,
      incident_date: incidentDate || undefined,
      knowledge_date: knowledgeDate || undefined,
      incident_description: incidentDescription || undefined,
      discipline_imposed: discipline,
      discipline_letter_date: disciplineLetterDate || undefined,
      employer_stated_grounds: statedGrounds || undefined,
      grievance_filed: filed,
      grievance_filed_date: filed ? (filedDate || undefined) : undefined,
      grievance_number: filed ? (grievanceNumber || undefined) : undefined,
      current_step: filed ? (currentStep || undefined) : undefined,
      last_step_response_date: filed ? (lastStepResponseDate || undefined) : undefined,
      prior_discipline: priorDiscipline,
      prior_discipline_details: priorDiscipline ? (priorDetails || undefined) : undefined,
      sunset_clause_months: priorDiscipline ? num(sunsetMonths) : undefined,
      union_rep_present_at_meeting: repPresent,
      investigation_conducted: investigated,
      believes_discriminatory: discriminatory || undefined,
      discrimination_grounds: discriminatory && grounds.length > 0 ? grounds : undefined,
      accommodation_involved: accommodation || undefined,
      accommodation_details: accommodation ? (accommodationDetails || undefined) : undefined,
      ohsa_reprisal_alleged: ohsaReprisal || undefined,
      reprisal_details: ohsaReprisal ? (reprisalDetails || undefined) : undefined,
      off_duty_conduct: offDuty || undefined,
      off_duty_details: offDuty ? (offDutyDetails || undefined) : undefined,
      remedy_sought: remedy || undefined,
      back_pay_estimate: num(backPay),
      dfr_concern: dfrConcern || undefined,
      dfr_details: dfrConcern ? (dfrDetails || undefined) : undefined,
    };
    // Strip undefined so Zod optional fields validate cleanly
    for (const k of Object.keys(intake)) {
      if (intake[k] === undefined) delete intake[k];
    }
    try {
      const result = await createGrievance(intake);
      onNav(`#/matter-detail/${result.matterId}`);
    } catch { /* error surfaced by the hook */ }
  }, [
    createGrievance, onNav, grievorFirst, grievorLast, classification, seniorityDate,
    unionName, unionRep, employerName, workplace, caTitle, procedureArticle, justCauseArticle,
    filingDays, filingKind, referralDays, referralKind, limitsMandatory, grievanceType,
    incidentDate, knowledgeDate, incidentDescription, discipline, disciplineLetterDate, statedGrounds,
    filed, filedDate, grievanceNumber, currentStep, lastStepResponseDate,
    priorDiscipline, priorDetails, sunsetMonths, repPresent, investigated,
    discriminatory, grounds, accommodation, accommodationDetails, ohsaReprisal, reprisalDetails,
    offDuty, offDutyDetails, remedy, backPay, dfrConcern, dfrDetails,
  ]);

  return (
    <>
      {/* ── Grievor & parties ─────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionLabel>Grievor</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={subLabelStyle}>First name</div>
            <input type="text" placeholder="e.g., Rosa" value={grievorFirst} onChange={e => setGrievorFirst(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Last name</div>
            <input type="text" placeholder="e.g., Delgado" value={grievorLast} onChange={e => setGrievorLast(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Classification / position</div>
            <input type="text" placeholder="e.g., Personal Support Worker" value={classification} onChange={e => setClassification(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Seniority date</div>
            <input type="date" value={seniorityDate} onChange={e => setSeniorityDate(e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <SectionLabel>Union &amp; Employer</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={subLabelStyle}>Union &amp; local</div>
            <input type="text" placeholder="e.g., USW Local 1998" value={unionName} onChange={e => setUnionName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Steward / LRO on the file</div>
            <input type="text" placeholder="e.g., Sam Odogwu" value={unionRep} onChange={e => setUnionRep(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Employer</div>
            <input type="text" placeholder="e.g., Lakeview Care Homes Inc" value={employerName} onChange={e => setEmployerName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Workplace / location</div>
            <input type="text" placeholder="e.g., Lakeview Site B, Oshawa" value={workplace} onChange={e => setWorkplace(e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* ── Collective agreement ──────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionLabel hint="upload the CA on the matter to auto-fill">Collective agreement time limits</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={subLabelStyle}>Agreement title / term</div>
            <input type="text" placeholder="e.g., 2024–2027 Collective Agreement" value={caTitle} onChange={e => setCaTitle(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Grievance procedure article</div>
            <input type="text" placeholder="e.g., Article 8" value={procedureArticle} onChange={e => setProcedureArticle(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Just cause article</div>
            <input type="text" placeholder="e.g., Article 7.01" value={justCauseArticle} onChange={e => setJustCauseArticle(e.target.value)} style={inputStyle} />
          </div>
          <div />
          <div>
            <div style={subLabelStyle}>Days to file the grievance</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" inputMode="numeric" placeholder="e.g., 10" value={filingDays} onChange={e => setFilingDays(e.target.value.replace(/[^\d]/g, ''))} style={{ ...inputStyle, width: 90 }} />
              <select value={filingKind} onChange={e => setFilingKind(e.target.value)} aria-label="Filing day kind" style={{ ...inputStyle, width: 'auto', flex: 1 }}>
                <option value="working">working days</option>
                <option value="calendar">calendar days</option>
              </select>
            </div>
          </div>
          <div>
            <div style={subLabelStyle}>Days to refer to arbitration</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" inputMode="numeric" placeholder="e.g., 30" value={referralDays} onChange={e => setReferralDays(e.target.value.replace(/[^\d]/g, ''))} style={{ ...inputStyle, width: 90 }} />
              <select value={referralKind} onChange={e => setReferralKind(e.target.value)} aria-label="Referral day kind" style={{ ...inputStyle, width: 'auto', flex: 1 }}>
                <option value="calendar">calendar days</option>
                <option value="working">working days</option>
              </select>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Check label="The CA states time limits are mandatory (late grievances deemed abandoned)" checked={limitsMandatory} onChange={setLimitsMandatory} />
        </div>
        {filingPreview && (
          <div style={{
            display: 'flex', gap: 10, background: '#eef1f6', border: `1px solid ${border}`,
            borderLeft: `3px solid ${navy}`, padding: '12px 14px', fontSize: 12.5,
            color: muted, marginTop: 10, borderRadius: 2,
          }}>
            <span style={{ fontSize: 14, color: navy, fontWeight: 700, flexShrink: 0, lineHeight: 1.4 }}>i</span>
            <span>
              Filing deadline computes to <b style={{ color: navy }}>{filingPreview.date}</b>
              {filingPreview.approximate ? ' (working days — statutory holidays not counted; verify against the CA)' : ''}.
              Starling puts this on the docket the moment the matter is created.
            </span>
          </div>
        )}
      </div>

      {/* ── The incident ──────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionLabel>The grievance</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={subLabelStyle}>Grievance type</div>
            <select value={grievanceType} onChange={e => setGrievanceType(e.target.value)} style={inputStyle}>
              {GRIEVANCE_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <div style={subLabelStyle}>Discipline imposed</div>
            <select value={discipline} onChange={e => setDiscipline(e.target.value)} style={inputStyle}>
              {DISCIPLINE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <div style={subLabelStyle}>Incident date</div>
            <input type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>When the union/grievor learned of it (if different)</div>
            <input type="date" value={knowledgeDate} onChange={e => setKnowledgeDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Discipline letter date</div>
            <input type="date" value={disciplineLetterDate} onChange={e => setDisciplineLetterDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Employer's stated grounds</div>
            <input type="text" placeholder="e.g., alleged time theft" value={statedGrounds} onChange={e => setStatedGrounds(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={subLabelStyle}>What happened</div>
          <textarea
            placeholder="e.g., Grievor discharged after 11 years for a single alleged safety infraction. No investigation meeting; steward not called in. Employer relies on a written warning from 2019."
            value={incidentDescription}
            onChange={e => setIncidentDescription(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 104, lineHeight: 1.55 }}
          />
        </div>
      </div>

      {/* ── Procedure history ─────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionLabel>Grievance procedure history</SectionLabel>
        <Check label="Grievance already filed" checked={filed} onChange={setFiled} />
        {filed && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
            <div>
              <div style={subLabelStyle}>Filed date</div>
              <input type="date" value={filedDate} onChange={e => setFiledDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={subLabelStyle}>Grievance number</div>
              <input type="text" placeholder="e.g., 2026-014" value={grievanceNumber} onChange={e => setGrievanceNumber(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={subLabelStyle}>Current step</div>
              <input type="text" placeholder="e.g., Step 2" value={currentStep} onChange={e => setCurrentStep(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={subLabelStyle}>Last step response date (starts the referral clock)</div>
              <input type="date" value={lastStepResponseDate} onChange={e => setLastStepResponseDate(e.target.value)} style={inputStyle} />
            </div>
          </div>
        )}
      </div>

      {/* ── Record & procedure ────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionLabel>Record &amp; process</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Check label="Union representative was present at the disciplinary meeting" checked={repPresent} onChange={setRepPresent} />
          <Check label="Employer conducted an investigation before discipline" checked={investigated} onChange={setInvestigated} />
          <Check label="Employer relies on prior discipline" checked={priorDiscipline} onChange={setPriorDiscipline} />
        </div>
        {priorDiscipline && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginTop: 12 }}>
            <div>
              <div style={subLabelStyle}>Prior discipline details</div>
              <input type="text" placeholder="e.g., written warning 2019 (not grieved), 1-day suspension 2023" value={priorDetails} onChange={e => setPriorDetails(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={subLabelStyle}>Sunset clause (months)</div>
              <input type="text" inputMode="numeric" placeholder="e.g., 24" value={sunsetMonths} onChange={e => setSunsetMonths(e.target.value.replace(/[^\d]/g, ''))} style={inputStyle} />
            </div>
          </div>
        )}
      </div>

      {/* ── Overlays ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionLabel>Statutory overlays</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Check label="Grievor believes the treatment was discriminatory (Human Rights Code)" checked={discriminatory} onChange={setDiscriminatory} />
          {discriminatory && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 24 }}>
              {CODE_GROUNDS.map(g => (
                <button
                  key={g}
                  onClick={() => toggleGround(g)}
                  type="button"
                  aria-pressed={grounds.includes(g)}
                  style={{
                    fontSize: 12, padding: '5px 11px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                    border: `1px solid ${grounds.includes(g) ? navy : border}`,
                    background: grounds.includes(g) ? navy : '#fff',
                    color: grounds.includes(g) ? '#fff' : muted,
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
          <Check label="Accommodation is involved" checked={accommodation} onChange={setAccommodation} />
          {accommodation && (
            <input type="text" placeholder="Accommodation details" value={accommodationDetails} onChange={e => setAccommodationDetails(e.target.value)} style={{ ...inputStyle, marginLeft: 24, width: 'calc(100% - 24px)' }} />
          )}
          <Check label="OHSA reprisal alleged (discipline after a safety complaint / work refusal)" checked={ohsaReprisal} onChange={setOhsaReprisal} />
          {ohsaReprisal && (
            <input type="text" placeholder="Reprisal details" value={reprisalDetails} onChange={e => setReprisalDetails(e.target.value)} style={{ ...inputStyle, marginLeft: 24, width: 'calc(100% - 24px)' }} />
          )}
          <Check label="Discipline is for off-duty conduct" checked={offDuty} onChange={setOffDuty} />
          {offDuty && (
            <input type="text" placeholder="Off-duty conduct details" value={offDutyDetails} onChange={e => setOffDutyDetails(e.target.value)} style={{ ...inputStyle, marginLeft: 24, width: 'calc(100% - 24px)' }} />
          )}
          <Check label="DFR exposure — grievor has raised or threatened a s. 74 complaint" checked={dfrConcern} onChange={setDfrConcern} />
          {dfrConcern && (
            <input type="text" placeholder="DFR concern details" value={dfrDetails} onChange={e => setDfrDetails(e.target.value)} style={{ ...inputStyle, marginLeft: 24, width: 'calc(100% - 24px)' }} />
          )}
        </div>
      </div>

      {/* ── Remedy ────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionLabel>Remedy sought</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <div>
            <div style={subLabelStyle}>Remedy</div>
            <input type="text" placeholder="e.g., Reinstatement with full back pay and no loss of seniority" value={remedy} onChange={e => setRemedy(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={subLabelStyle}>Back pay estimate (CAD)</div>
            <input type="text" inputMode="numeric" placeholder="e.g., 48000" value={backPay} onChange={e => setBackPay(e.target.value.replace(/[^\d.]/g, ''))} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* ── Submit bar ────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 30, paddingTop: 22, borderTop: `1px solid ${border}`,
      }}>
        <div style={{ fontSize: 13, color: muted }}>
          Gate analysis and CA deadline clocks are computed instantly — <b style={{ color: ink }}>no AI cost</b> at intake
        </div>
        <div>
          <button
            onClick={() => onNav('#/')}
            style={{
              background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 14,
              padding: '13px 20px', borderRadius: 2, cursor: 'pointer', marginRight: 10, fontFamily: sans,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={creating}
            style={{
              background: creating ? '#b0b0b0' : orange, color: '#fff', fontSize: 14.5, fontWeight: 600,
              padding: '13px 24px', borderRadius: 2, border: 'none',
              cursor: creating ? 'not-allowed' : 'pointer', fontFamily: sans,
            }}
          >
            {creating ? 'Creating grievance...' : <>Create Grievance Matter &rarr;</>}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: 14, padding: '12px 16px', border: '1px solid #dc2626', borderRadius: 2,
          background: '#fce8e6', color: '#dc2626', fontSize: 13.5,
        }}>
          {error}
        </div>
      )}
      <div style={{ fontSize: 12, color: muted, marginTop: 14, fontFamily: serif }}>
        Time limits come from the collective agreement, not statute. Working-day computations exclude
        weekends but not statutory holidays — verify docket dates against the CA before relying on them.
      </div>
    </>
  );
}
