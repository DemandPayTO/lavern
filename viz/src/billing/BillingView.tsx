/**
 * BillingView — Hour pack purchase + usage history for DemandPay Starling.
 *
 * Displays current balance, available packs, and transaction ledger.
 * Purchase flow: click Buy → redirected to Stripe Checkout → return here.
 */

import { useState, useEffect, useCallback } from 'react';

// ── Design Tokens ───────────────────────────────────────────────────────
const navy = '#0f1a2e';
const orange = '#ea580c';
const cream = '#faf8f5';
const frame = '#e8e5e0';
const green = '#16a34a';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const serif = "Georgia, 'Palatino Linotype', serif";
const sans = "system-ui, -apple-system, sans-serif";

// ── Types ───────────────────────────────────────────────────────────────

interface Pack {
  hours: number;
  priceCents: number;
  label: string;
}

interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
}

interface BillingData {
  balance: number;
  usage: { total_cost_usd: number; engagement_count: number };
  history: LedgerEntry[];
  packs: Record<string, Pack>;
  currency: string;
}

// ── Component ───────────────────────────────────────────────────────────

export default function BillingView() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check for checkout result in URL
  const [checkoutResult] = useState(() => {
    const hash = window.location.hash;
    if (hash.includes('checkout=success')) return 'success';
    if (hash.includes('checkout=cancelled')) return 'cancelled';
    return null;
  });

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/balance', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load billing data');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  const handleBuy = useCallback(async (packId: string) => {
    setPurchasing(packId);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ packId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Checkout failed' }));
        throw new Error(err.error ?? 'Checkout failed');
      }
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setPurchasing(null);
    }
  }, []);

  const formatCurrency = useCallback((cents: number, currency: string) => {
    const amount = (cents / 100).toFixed(2);
    const symbol = currency.toLowerCase() === 'cad' ? 'CA$' : '$';
    return `${symbol}${amount}`;
  }, []);

  if (loading) {
    return (
      <div style={{ fontFamily: sans, background: frame, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: muted, fontSize: 14 }}>Loading billing...</div>
      </div>
    );
  }

  const currency = data?.currency ?? 'cad';
  const packs = data?.packs ?? {};
  const packEntries = Object.entries(packs);

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      {/* ── Top Bar ──────────────────────────────────────────────── */}
      <header
        style={{
          background: navy,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          height: 64,
        }}
        role="banner"
      >
        <a href="#/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }} aria-label="DemandPay Starling home">
          <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
          </span>
          <span style={{ fontFamily: serif, lineHeight: 1, letterSpacing: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>DEMAND</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>PAY</span>
          </span>
        </a>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Main navigation">
          <a href="#/" style={{ padding: '8px 14px', fontSize: 14, color: '#cfd6e0', textDecoration: 'none' }}>My Cases</a>
          <a href="#/billing" style={{ padding: '8px 14px', fontSize: 14, color: '#fff', fontWeight: 600, textDecoration: 'none', borderBottom: `2px solid ${orange}` }}>Billing</a>
        </nav>
      </header>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main id="main-content" style={{ maxWidth: 760, margin: '0 auto', padding: '24px 28px 64px' }}>
        <a href="#/" onClick={(e) => { e.preventDefault(); window.location.hash = '#/'; }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: muted, fontSize: 13.5, marginBottom: 18, textDecoration: 'none' }}>
          &larr; My Cases
        </a>

        <h1 style={{ fontFamily: serif, fontSize: 25, fontWeight: 600, color: navy, margin: '0 0 24px' }}>
          Billing &amp; Usage
        </h1>

        {/* Checkout result banner */}
        {checkoutResult === 'success' && (
          <div style={{ padding: '14px 18px', background: '#dcfce7', border: `1px solid ${green}`, borderRadius: 2, fontSize: 14, color: '#166534', marginBottom: 20 }}>
            Purchase complete. Your hours have been credited.
          </div>
        )}
        {checkoutResult === 'cancelled' && (
          <div style={{ padding: '14px 18px', background: '#fef3c7', border: '1px solid #d97706', borderRadius: 2, fontSize: 14, color: '#92400e', marginBottom: 20 }}>
            Checkout was cancelled. No charge was made.
          </div>
        )}

        {error && (
          <div style={{ padding: '14px 18px', background: '#fce8e6', border: '1px solid #dc2626', borderRadius: 2, fontSize: 14, color: '#dc2626', marginBottom: 20 }}>
            {error}
          </div>
        )}

        {/* Balance card */}
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '28px 32px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Current Balance</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: serif, fontSize: 42, fontWeight: 700, color: (data?.balance ?? 0) > 0 ? navy : '#dc2626' }}>
              {(data?.balance ?? 0).toFixed(1)}
            </span>
            <span style={{ fontSize: 16, color: muted }}>hours</span>
          </div>
          {data?.usage && data.usage.engagement_count > 0 && (
            <div style={{ fontSize: 13, color: muted, marginTop: 8 }}>
              This month: {data.usage.engagement_count} session{data.usage.engagement_count !== 1 ? 's' : ''}, {formatCurrency(Math.round(data.usage.total_cost_usd * 100), currency)} in API costs
            </div>
          )}
        </div>

        {/* Hour packs */}
        <h2 style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, color: navy, margin: '28px 0 14px' }}>Purchase Hours</h2>
        <div style={{ display: 'grid', gridTemplateColumns: packEntries.length >= 3 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 14, marginBottom: 28 }}>
          {packEntries.map(([id, pack]) => (
            <div key={id} style={{ background: '#fff', border: `1px solid ${border}`, padding: '24px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{pack.label}</div>
              <div style={{ fontFamily: serif, fontSize: 32, fontWeight: 700, color: navy, marginBottom: 4 }}>{pack.hours}</div>
              <div style={{ fontSize: 14, color: muted, marginBottom: 16 }}>hours</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: ink, marginBottom: 16 }}>{formatCurrency(pack.priceCents, currency)}</div>
              <button
                onClick={() => handleBuy(id)}
                disabled={purchasing !== null}
                style={{
                  width: '100%',
                  background: purchasing === id ? '#b0b0b0' : orange,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  padding: '11px 0',
                  borderRadius: 2,
                  border: 'none',
                  cursor: purchasing !== null ? 'not-allowed' : 'pointer',
                  fontFamily: sans,
                }}
              >
                {purchasing === id ? 'Redirecting...' : 'Buy'}
              </button>
            </div>
          ))}
        </div>

        {/* Transaction history */}
        {data?.history && data.history.length > 0 && (
          <>
            <h2 style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, color: navy, margin: '28px 0 14px' }}>Transaction History</h2>
            <div style={{ background: '#fff', border: `1px solid ${border}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${border}` }}>
                    <th style={{ textAlign: 'left', padding: '10px 14px', color: muted, fontWeight: 500 }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '10px 14px', color: muted, fontWeight: 500 }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', color: muted, fontWeight: 500 }}>Hours</th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', color: muted, fontWeight: 500 }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map(entry => (
                    <tr key={entry.id} style={{ borderBottom: `1px solid ${border}` }}>
                      <td style={{ padding: '10px 14px', color: muted }}>
                        {new Date(entry.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                      </td>
                      <td style={{ padding: '10px 14px', color: ink }}>{entry.description ?? entry.type}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: entry.amount > 0 ? green : '#dc2626', fontWeight: 600, fontFamily: 'monospace' }}>
                        {entry.amount > 0 ? '+' : ''}{entry.amount.toFixed(1)}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: muted, fontFamily: 'monospace' }}>
                        {entry.balance_after.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
