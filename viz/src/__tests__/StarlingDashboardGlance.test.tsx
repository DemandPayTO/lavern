/**
 * StarlingDashboard — Today glance + Recent matters.
 *
 * The dashboard is a daily glance: up to 5 items due today/overdue (court
 * deadlines always surface within 5 days), and the most recently saved
 * files. Full task management lives on the Tasks tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

vi.mock('../starling/hooks/useStarlingApi.js', () => ({
  useMatterList: () => ({
    matters: [
      { id: 'm1', name: 'Ana Reyes', number: 'SL-441', status: 'active', statusColour: '#16a34a', flagText: '', flagColour: 'navy', description: '', metaLabel: '', metaValue: '' },
      { id: 'm2', name: 'Omar Diallo', number: 'DP-2', status: 'active', statusColour: '#16a34a', flagText: '', flagColour: 'navy', description: '', metaLabel: '', metaValue: '' },
    ],
    loading: false,
    refresh: vi.fn(),
  }),
  usePracticeMode: () => 'employment',
}));

import StarlingDashboard from '../starling/StarlingDashboard.js';

const INBOX = {
  ok: true,
  tasks: [
    { id: 'ai-od', matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441', title: 'Send mitigation reminder', source: 'action', kind: 'email', dueDate: isoDaysFromNow(-2), isCourt: false, band: 'overdue', status: 'open' },
    { id: 'm1-timeline', matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441', title: 'Statement of Defence due', source: 'deadline', kind: 'timeline', dueDate: isoDaysFromNow(4), isCourt: true, band: 'week', status: 'open' },
    { id: 'ai-later', matterId: 'm2', matterLabel: 'Omar Diallo v Gamma Corp', fileNumber: 'DP-2', title: 'Review disclosure', source: 'action', kind: 'task', dueDate: isoDaysFromNow(30), isCourt: false, band: 'later', status: 'open' },
  ],
  matters: [
    { matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441', status: 'active', updatedAt: '2026-07-19T10:00:00Z' },
    { matterId: 'm2', matterLabel: 'Omar Diallo v Gamma Corp', fileNumber: 'DP-2', status: 'active', updatedAt: '2026-07-20T10:00:00Z' },
  ],
  counts: { overdue: 1, today: 0, week: 1, later: 1, none: 0, done: 0 },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/tasks') return { ok: true, json: async () => INBOX } as Response;
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }));
});

describe('StarlingDashboard glance', () => {
  it('shows due-today/overdue items plus court deadlines within 5 days', async () => {
    render(<StarlingDashboard />);
    await waitFor(() => expect(screen.getByText('Send mitigation reminder')).toBeInTheDocument());
    // Court deadline in 4 days surfaces even though it is not due today
    expect(screen.getByText('Statement of Defence due')).toBeInTheDocument();
    expect(screen.getByText('COURT')).toBeInTheDocument();
    // Non-court item 30 days out stays off the glance
    expect(screen.queryByText('Review disclosure')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View all tasks/ })).toBeInTheDocument();
  });

  it('lists recent matters most-recently-saved first', async () => {
    render(<StarlingDashboard />);
    await waitFor(() => expect(screen.getByLabelText('Recently updated matters')).toBeInTheDocument());
    const region = screen.getByLabelText('Recently updated matters');
    const labels = Array.from(region.querySelectorAll('[role="listitem"]')).map(el => el.textContent ?? '');
    expect(labels[0]).toContain('Omar Diallo v Gamma Corp'); // updated 2026-07-20 > 2026-07-19
    expect(labels[1]).toContain('Ana Reyes v Beta Inc');
  });

  it('shows the calm empty state when nothing is due', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/tasks') {
        return {
          ok: true,
          json: async () => ({ ok: true, tasks: [], matters: INBOX.matters, counts: { overdue: 0, today: 0, week: 0, later: 0, none: 0, done: 0 } }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));
    render(<StarlingDashboard />);
    await waitFor(() => expect(screen.getByText(/Nothing due today and nothing overdue/)).toBeInTheDocument());
  });
});
