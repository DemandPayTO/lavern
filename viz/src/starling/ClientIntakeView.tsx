/**
 * ClientIntakeView — the public client intake form, reached through a
 * tokenized link the lawyer generates. Plain language throughout: the
 * reader has just lost their job and is not a lawyer.
 *
 * The token is the capability; the page reveals only the firm's name.
 * Submissions go to the lawyer for review; nothing the client types
 * changes the matter until the lawyer applies it.
 */

import { useState, useEffect, useCallback } from 'react';
import { navy, orange, cream, frame, border, ink, muted, serif, sans } from './shared.js';

const inputStyle: React.CSSProperties = {
  width: '100%', fontFamily: sans, fontSize: 15, color: ink,
  border: `1px solid ${border}`, borderRadius: 2,
  padding: '12px 14px', background: '#fff', boxSizing: 'border-box',
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: navy, marginBottom: 6 }}>{label}</label>
      {hint && <div style={{ fontSize: 12.5, color: muted, marginBottom: 6 }}>{hint}</div>}
      {children}
    </div>
  );
}

export default function ClientIntakeView() {
  const token = window.location.hash.match(/#\/client-intake\/([A-Za-z0-9_-]+)/)?.[1] ?? '';
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'submitted'>('loading');
  const [firmName, setFirmName] = useState('');
  const [errorText, setErrorText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [age, setAge] = useState('');
  const [employer, setEmployer] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [terminationDate, setTerminationDate] = useState('');
  const [salary, setSalary] = useState('');
  const [reason, setReason] = useState('');
  const [offerReceived, setOfferReceived] = useState(false);
  const [offerDeadline, setOfferDeadline] = useState('');
  const [narrative, setNarrative] = useState('');

  useEffect(() => {
    if (!token) { setState('invalid'); setErrorText('This link is not valid.'); return; }
    fetch(`/api/intake-portal/${token}`)
      .then(async r => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok) { setState('invalid'); setErrorText(json.error ?? 'This link is not valid.'); return; }
        setFirmName(json.firmName ?? '');
        if (json.clientFirstName) setFirstName(json.clientFirstName);
        setState('ready');
      })
      .catch(() => { setState('invalid'); setErrorText('The form could not be loaded. Try again in a moment.'); });
  }, [token]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    const body: Record<string, unknown> = {};
    const put = (k: string, v: string | boolean | number | undefined) => {
      if (v !== undefined && v !== '' && v !== false) body[k] = v;
    };
    put('client_first_name', firstName.trim());
    put('client_last_name', lastName.trim());
    put('client_email', email.trim());
    put('client_phone', phone.trim());
    put('client_address', address.trim());
    const ageNum = parseInt(age, 10);
    if (Number.isFinite(ageNum) && ageNum >= 14 && ageNum <= 120) body.client_age = ageNum;
    put('employer_legal_name', employer.trim());
    put('job_title', jobTitle.trim());
    put('hire_date', hireDate);
    put('termination_date', terminationDate);
    const salaryNum = parseFloat(salary.replace(/[^\d.]/g, ''));
    if (Number.isFinite(salaryNum) && salaryNum > 0) body.annual_salary = salaryNum;
    put('termination_reasons', reason.trim());
    if (offerReceived) { body.received_severance_offer = true; put('severance_deadline', offerDeadline); }
    put('client_narrative', narrative.trim());

    try {
      const res = await fetch(`/api/intake-portal/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorText(json.error ?? 'Your answers could not be sent. Try again.'); }
      else setState('submitted');
    } catch {
      setErrorText('Your answers could not be sent. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }, [token, firstName, lastName, email, phone, address, age, employer, jobTitle, hireDate, terminationDate, salary, reason, offerReceived, offerDeadline, narrative]);

  const shell = (content: React.ReactNode) => (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.55, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      <header style={{ background: navy, color: '#fff', display: 'flex', alignItems: 'center', padding: '0 28px', height: 64 }}>
        <span style={{ display: 'flex', gap: 4, marginRight: 12 }} aria-hidden="true">
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
        </span>
        <span style={{ fontFamily: serif, fontSize: 16 }}>{firmName || 'Client intake'}</span>
      </header>
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 24px 64px' }}>{content}</main>
    </div>
  );

  if (state === 'loading') return shell(<p style={{ color: muted }}>Loading your intake form...</p>);
  if (state === 'invalid') {
    return shell(
      <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '28px 30px' }}>
        <h1 style={{ fontFamily: serif, fontSize: 22, color: navy, marginTop: 0 }}>This link is not available</h1>
        <p style={{ color: muted }}>{errorText} If you received this link from your lawyer, contact them for a new one.</p>
      </div>,
    );
  }
  if (state === 'submitted') {
    return shell(
      <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '28px 30px' }}>
        <h1 style={{ fontFamily: serif, fontSize: 22, color: navy, marginTop: 0 }}>Thank you</h1>
        <p>Your answers have been sent to {firmName || 'your lawyer'}. They will review everything with you; nothing is final until you have spoken.</p>
        <p style={{ color: muted, fontSize: 13.5 }}>You can close this page.</p>
      </div>,
    );
  }

  return shell(
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '30px 32px' }}>
      <h1 style={{ fontFamily: serif, fontSize: 24, color: navy, margin: '0 0 6px' }}>Tell us about your situation</h1>
      <p style={{ color: muted, fontSize: 14.5, marginBottom: 26 }}>
        {firmName ? `${firmName} asked you to fill in this form.` : 'Your lawyer asked you to fill in this form.'}{' '}
        Answer what you can; leave anything you are unsure about blank. Everything goes directly to your
        lawyer, who will review it with you.
      </p>

      <h2 style={{ fontFamily: serif, fontSize: 16, color: navy }}>About you</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="First name"><input style={inputStyle} value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" /></Field>
        <Field label="Last name"><input style={inputStyle} value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="family-name" /></Field>
        <Field label="Email"><input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
        <Field label="Phone"><input style={inputStyle} type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" /></Field>
        <Field label="Home address"><input style={inputStyle} value={address} onChange={e => setAddress(e.target.value)} autoComplete="street-address" /></Field>
        <Field label="Age"><input style={inputStyle} inputMode="numeric" value={age} onChange={e => setAge(e.target.value.replace(/[^\d]/g, ''))} /></Field>
      </div>

      <h2 style={{ fontFamily: serif, fontSize: 16, color: navy, marginTop: 10 }}>Your job</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Employer's name" hint="As it appears on your pay stub or offer letter, if you have one handy.">
          <input style={inputStyle} value={employer} onChange={e => setEmployer(e.target.value)} />
        </Field>
        <Field label="Your job title"><input style={inputStyle} value={jobTitle} onChange={e => setJobTitle(e.target.value)} /></Field>
        <Field label="When did you start?"><input style={inputStyle} type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} /></Field>
        <Field label="When did the job end?"><input style={inputStyle} type="date" value={terminationDate} onChange={e => setTerminationDate(e.target.value)} /></Field>
        <Field label="Your yearly pay, before tax" hint="An estimate is fine.">
          <input style={inputStyle} inputMode="decimal" placeholder="e.g., 65000" value={salary} onChange={e => setSalary(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        <Field label="What reason were you given?" hint="For example: restructuring, performance, or no reason at all.">
          <input style={inputStyle} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
      </div>

      <div style={{ margin: '4px 0 18px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, color: ink, cursor: 'pointer' }}>
          <input type="checkbox" checked={offerReceived} onChange={e => setOfferReceived(e.target.checked)} style={{ accentColor: orange }} />
          The employer offered me a severance package
        </label>
        {offerReceived && (
          <div style={{ marginTop: 10, maxWidth: 280 }}>
            <Field label="Deadline to accept the offer, if one was given">
              <input style={inputStyle} type="date" value={offerDeadline} onChange={e => setOfferDeadline(e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      <Field label="In your own words, what happened?" hint="Dates help where you remember them. Do not worry about legal terms.">
        <textarea style={{ ...inputStyle, minHeight: 140, resize: 'vertical' }} value={narrative} onChange={e => setNarrative(e.target.value)} maxLength={5000} />
      </Field>

      {errorText && <p style={{ color: '#dc2626', fontSize: 13.5 }} role="alert">{errorText}</p>}
      <button
        onClick={submit}
        disabled={submitting}
        style={{
          background: submitting ? '#b0b0b0' : orange, color: '#fff', fontSize: 15, fontWeight: 600,
          padding: '13px 26px', borderRadius: 2, border: 'none',
          cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: sans,
        }}
      >
        {submitting ? 'Sending...' : 'Send to my lawyer'}
      </button>
      <p style={{ color: muted, fontSize: 12.5, marginTop: 14 }}>
        Your answers are sent only to your lawyer. Nothing is filed or decided until you have reviewed it together.
      </p>
    </div>,
  );
}
