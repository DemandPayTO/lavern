/**
 * TasksView — Component tests.
 *
 * The inbox fetches /api/tasks, groups by band, checks items off via
 * PATCH, quick-adds via POST, and manages the calendar feed token.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TasksView from '../starling/TasksView.js';

const INBOX = {
  ok: true,
  tasks: [
    {
      id: 'ai-1', matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441',
      title: 'Send mitigation reminder', source: 'action', kind: 'email',
      dueDate: '2026-07-10', isCourt: false, band: 'overdue', status: 'open',
      emailSubject: 'Mitigation update', emailBody: 'Draft body',
    },
    {
      id: 'm1-timeline-2026-07-24', matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441',
      title: 'Statement of Defence due', source: 'deadline', kind: 'timeline',
      dueDate: '2026-07-24', isCourt: true, band: 'week', status: 'open',
    },
    {
      id: 'ai-2', matterId: 'm2', matterLabel: 'Omar Diallo v Gamma Corp', fileNumber: 'DP-2026-0002',
      title: 'File HRTO application', source: 'action', kind: 'filing',
      dueDate: null, isCourt: false, band: 'none', status: 'open',
    },
    {
      id: 'ai-3', matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441',
      title: 'Send retainer', source: 'action', kind: 'email',
      dueDate: '2026-07-01', isCourt: false, band: 'none', status: 'done',
    },
  ],
  matters: [
    { matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441' },
    { matterId: 'm2', matterLabel: 'Omar Diallo v Gamma Corp', fileNumber: 'DP-2026-0002' },
  ],
  counts: { overdue: 1, today: 0, week: 1, later: 0, none: 1, done: 1 },
};

function mockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const key = `${method} ${url}`;
    if (key in overrides) {
      return { ok: true, json: async () => overrides[key] } as Response;
    }
    if (key === 'GET /api/tasks') return { ok: true, json: async () => INBOX } as Response;
    if (key === 'GET /api/tasks/feed') return { ok: true, json: async () => ({ ok: true, active: false, createdAt: null }) } as Response;
    if (method === 'PATCH' || method === 'POST') return { ok: true, json: async () => ({ ok: true }) } as Response;
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('TasksView', () => {
  it('groups open tasks by band and hides done by default', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText('Send mitigation reminder')).toBeInTheDocument());
    expect(screen.getByText('Overdue', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('This week', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('No date', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('Statement of Defence due')).toBeInTheDocument();
    expect(screen.queryByText('Send retainer')).not.toBeInTheDocument(); // done hidden
  });

  it('reveals done tasks with the show-done toggle', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText('Send mitigation reminder')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText(/Show done/i));
    expect(screen.getByText('Send retainer')).toBeInTheDocument();
  });

  it('checks an action item off via PATCH', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText('Send mitigation reminder')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Mark done: Send mitigation reminder'));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(String(patch![0])).toBe('/api/tasks/m1/ai-1');
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ status: 'done' });
    });
  });

  it('quick-adds a task via POST with the picked matter', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText('Send mitigation reminder')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Task title'), 'Chase medical records');
    await userEvent.selectOptions(screen.getByLabelText('Matter'), 'm2');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c =>
        (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]) === '/api/tasks');
      expect(post).toBeDefined();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ matterId: 'm2', title: 'Chase medical records' });
    });
  });

  it('shows the weekly email opt-in when available and POSTs the toggle', async () => {
    const fetchMock = mockFetch({
      'GET /api/tasks/digest': { ok: true, available: true, optedIn: false },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText('Send mitigation reminder')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Calendar subscription' }));
    const box = await screen.findByLabelText('Weekly task email');
    await userEvent.click(box);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c =>
        (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]) === '/api/tasks/digest');
      expect(post).toBeDefined();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ optIn: true });
    });
  });

  it('hides the weekly email opt-in in LOCAL MODE (unavailable)', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'GET /api/tasks/digest': { ok: true, available: false, optedIn: false },
    }));
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText('Send mitigation reminder')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Calendar subscription' }));
    expect(screen.queryByLabelText('Weekly task email')).not.toBeInTheDocument();
  });

  it('mints a subscribe link and shows both copy affordances', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'POST /api/tasks/feed': { ok: true, path: '/api/tasks/calendar/tok123.ics' },
    }));
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText('Send mitigation reminder')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Calendar subscription' }));
    await userEvent.click(screen.getByRole('button', { name: 'Generate subscribe link' }));
    await waitFor(() => {
      expect(screen.getByText('Your subscribe link (shown once, copy it now)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy webcal link/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy https link/i })).toBeInTheDocument();
    });
  });

  it('shows the empty state when there is nothing outstanding', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'GET /api/tasks': { ok: true, tasks: [], matters: [], counts: { overdue: 0, today: 0, week: 0, later: 0, none: 0, done: 0 } },
    }));
    render(<TasksView />);
    await waitFor(() => expect(screen.getByText(/Nothing outstanding/)).toBeInTheDocument());
  });
});
