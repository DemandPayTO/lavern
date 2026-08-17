// The Intake tab: the full questionnaire, a quick-edit grid of the core
// analysis-driving fields, and the client intake portal. Extracted from
// MatterDetailView.tsx.

import { navy, orange, green, red, border, ink, muted, serif, sans } from '../tokens.js';
import { IntakeEditorPanel } from '../../shared.js';
import type { IntakeFieldDef } from '../../shared.js';
import { QuestionnairePanel } from '../../QuestionnairePanel.js';

// The core analysis-driving fields. The editor merges into the existing
// intake, so fields it does not show are preserved.
const EMPLOYMENT_INTAKE_FIELDS: IntakeFieldDef[] = [
  { key: 'client_first_name', label: 'Client first name' },
  { key: 'client_last_name', label: 'Client last name' },
  { key: 'client_age', label: 'Client age', type: 'number' },
  // The mediation brief's readiness hint points here for the profile
  // table's age row; the field has to exist to be pointed at.
  { key: 'client_date_of_birth', label: 'Client date of birth', type: 'date' },
  // Set by the lawyer, never inferred from the name. Every generated
  // document reads it; before this each one was picking for itself.
  {
    key: 'client_pronouns',
    label: 'How documents refer to the client',
    type: 'select',
    options: [
      ['', 'Not recorded (uses the name)'],
      ['she', 'she / her'],
      ['he', 'he / him'],
      ['they', 'they / them'],
      ['name', 'Name only, no pronouns'],
    ],
  },
  // Addresses only: the HRTO Form 1 and the court forms print them.
  // Email and phone stay off this grid on the pilot's direction: Starling
  // is a drafting and matter app, not a contact list. The court forms
  // print those lines blank when unset, for the lawyer to fill.
  { key: 'client_address', label: 'Client street address' },
  { key: 'client_city', label: 'Client city' },
  { key: 'client_postal_code', label: 'Client postal code' },
  { key: 'employer_legal_name', label: 'Employer legal name' },
  { key: 'employer_address', label: 'Employer address (service address on forms)' },
  { key: 'job_title', label: 'Job title' },
  { key: 'annual_salary', label: 'Annual salary (CAD)', type: 'number' },
  // The income breakdown: the brief's profile table and the damages story
  // read these, and until now only the questionnaire could set them.
  { key: 'bonus_amount', label: 'Annual bonus (CAD)', type: 'number' },
  { key: 'commission_amount', label: 'Annual commissions (CAD)', type: 'number' },
  { key: 'allowances_amount', label: 'Allowances per year (CAD)', type: 'number' },
  { key: 'allowances_details', label: 'Allowances, described (car, phone, housing)' },
  { key: 'hire_date', label: 'Hire date', type: 'date' },
  { key: 'years_of_service_estimate', label: 'Years of service (estimate, when the start date is unknown)', type: 'number' },
  { key: 'termination_date', label: 'Termination date', type: 'date' },
  { key: 'termination_reasons', label: 'Stated reason for termination' },
  { key: 'was_terminated', label: 'Terminated by the employer', type: 'checkbox' },
  { key: 'is_constructive_dismissal', label: 'Constructive dismissal', type: 'checkbox' },
  { key: 'employer_alleged_just_cause', label: 'Employer alleged just cause', type: 'checkbox' },
  { key: 'believes_discriminatory_termination', label: 'Discrimination dimension (starts the HRTO clock)', type: 'checkbox' },
  { key: 'received_severance_offer', label: 'Severance offer received', type: 'checkbox' },
  { key: 'severance_weeks_offered', label: 'Severance weeks offered', type: 'number' },
  { key: 'severance_deadline', label: 'Severance offer deadline', type: 'date' },
  // The smaller ESA wage claims. Ticking one makes it pleadable in the
  // Statement of Claim, so each label names the claim in plain words.
  { key: 'vacation_unpaid', label: 'Vacation pay unpaid at termination', type: 'checkbox' },
  { key: 'vacation_underpaid_rate', label: 'Vacation pay below the ESA 4% / 6% minimum', type: 'checkbox' },
  { key: 'vacation_excluded_variable_comp', label: 'Vacation pay not paid on commissions or bonuses', type: 'checkbox' },
  { key: 'holiday_pay_unpaid', label: 'Public holiday pay unpaid', type: 'checkbox' },
  { key: 'unpaid_overtime', label: 'Overtime unpaid', type: 'checkbox' },
  { key: 'unpaid_commission', label: 'Commission or bonus earned but unpaid', type: 'checkbox' },
  { key: 'unauthorized_deductions', label: 'Unauthorized deductions from wages', type: 'checkbox' },
  { key: 'expenses_unreimbursed', label: 'Business expenses unreimbursed', type: 'checkbox' },
  { key: 'esa_term_shortfall', label: 'ESA termination pay shortfall', type: 'checkbox' },
  { key: 'esa_sev_shortfall', label: 'ESA severance pay shortfall', type: 'checkbox' },
  { key: 'benefits_not_continued', label: 'Benefits not continued through the statutory notice period', type: 'checkbox' },
  // The fields that arm the claim's main attack sections. Without these
  // in the editor, a lawyer whose documents did not supply them had no
  // way to plead the clause attack or bad faith at all.
  { key: 'termination_clause_text', label: 'Termination clause, quoted from the contract (arms the clause attack)', type: 'textarea' },
  { key: 'clause_cause_broader', label: 'Clause attack: for-cause standard below wilful misconduct', type: 'checkbox' },
  { key: 'clause_no_benefits', label: 'Clause attack: benefits not continued through notice', type: 'checkbox' },
  { key: 'clause_limits_below_esa', label: 'Clause attack: purports to limit below ESA minimums', type: 'checkbox' },
  { key: 'bad_faith_details', label: 'Bad faith in the manner of dismissal (describe the conduct; arms the bad faith section)', type: 'textarea' },
];

type PendingClient = { data?: Record<string, unknown>; submittedAt?: string; appliedAt?: string } | null;

export function IntakeTab({
  intake, saveIntake, refreshEmployment, sessionId,
  intakeLink, setIntakeLink, intakeLinkCopied, setIntakeLinkCopied,
  portalMessage, setPortalMessage, pendingClient, refreshPendingClient,
}: {
  intake: Record<string, unknown>;
  saveIntake: (intake: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  refreshEmployment: () => void;
  sessionId: string | null;
  intakeLink: string | null;
  setIntakeLink: React.Dispatch<React.SetStateAction<string | null>>;
  intakeLinkCopied: boolean;
  setIntakeLinkCopied: React.Dispatch<React.SetStateAction<boolean>>;
  portalMessage: string | null;
  setPortalMessage: React.Dispatch<React.SetStateAction<string | null>>;
  pendingClient: PendingClient;
  refreshPendingClient: () => void;
}) {
  return (
    <div id="panel-intake" role="tabpanel" style={{ paddingTop: 22 }}>
      {/* The lawyer's own record comes first. The client portal
          used to sit on top of it, which made the intake look as
          though it could only be filled by sending the client a
          link. */}

      <QuestionnairePanel
        intake={intake}
        onSave={saveIntake}
      />
      <IntakeEditorPanel
        heading="Quick edit"
        subheading="The core fields in one grid, for fast corrections. The full intake above covers everything; both save to the same file."
        fields={EMPLOYMENT_INTAKE_FIELDS}
        values={intake}
        onSave={async (edited) => {
          const merged: Record<string, unknown> = { ...intake };
          for (const [k, v] of Object.entries(edited)) {
            if (v === undefined) delete merged[k];
            else merged[k] = v;
          }
          return saveIntake(merged);
        }}
      />

      {/* Client intake portal */}
      <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
          Client intake link
        </div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 12 }}>
          Send the client a link to answer the intake questions themselves. Their answers arrive
          here for your review; nothing changes on the matter until you apply them, and your own
          entries are never overwritten.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              setPortalMessage(null);
              try {
                const res = await fetch(`/api/employment/${sessionId}/intake-link`, { method: 'POST', credentials: 'include' });
                const json = await res.json();
                if (!res.ok) { setPortalMessage(json.error ?? 'The link could not be generated.'); return; }
                const url = `${window.location.origin}${json.path}`;
                setIntakeLink(url);
                try { await navigator.clipboard.writeText(url); setIntakeLinkCopied(true); setTimeout(() => setIntakeLinkCopied(false), 2500); } catch { /* clipboard optional */ }
              } catch {
                setPortalMessage('The link could not be generated.');
              }
            }}
            style={{ background: navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 2, border: 'none', cursor: 'pointer', fontFamily: sans }}
          >
            Generate client link
          </button>
          {intakeLink && (
            <span style={{ fontSize: 12.5, color: ink, wordBreak: 'break-all' as const }}>
              {intakeLink} {intakeLinkCopied && <b style={{ color: green }}>Copied</b>}
            </span>
          )}
          {portalMessage && <span style={{ fontSize: 12.5, color: red }} role="alert">{portalMessage}</span>}
        </div>
        {pendingClient?.data && !pendingClient.appliedAt && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 6 }}>
              Client submission received{pendingClient.submittedAt ? ` ${new Date(pendingClient.submittedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
            </div>
            <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>
              {Object.entries(pendingClient.data).filter(([k, v]) => k !== 'client_narrative' && v !== '' && v != null).map(([k, v]) => (
                <div key={k} style={{ padding: '2px 0' }}>
                  <span style={{ fontWeight: 600 }}>{k.replace(/_/g, ' ')}:</span> <span style={{ color: ink }}>{String(v)}</span>
                </div>
              ))}
              {typeof pendingClient.data.client_narrative === 'string' && pendingClient.data.client_narrative && (
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontWeight: 600 }}>In their words:</span>{' '}
                  <span style={{ color: ink }}>{String(pendingClient.data.client_narrative)}</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  const res = await fetch(`/api/employment/${sessionId}/apply-client-intake`, { method: 'POST', credentials: 'include' });
                  const json = await res.json().catch(() => ({}));
                  setPortalMessage(res.ok
                    ? `Applied ${(json.appliedFields ?? []).length} field(s); blank fields only. Review the intake below and re-run the analysis.`
                    : json.error ?? 'The submission could not be applied.');
                  refreshPendingClient();
                  refreshEmployment();
                }}
                style={{ background: orange, color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, border: 'none', cursor: 'pointer', fontFamily: sans }}
              >
                Apply to the intake
              </button>
              <button
                onClick={async () => {
                  await fetch(`/api/employment/${sessionId}/client-intake`, { method: 'DELETE', credentials: 'include' });
                  refreshPendingClient();
                }}
                style={{ background: '#fff', color: muted, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
