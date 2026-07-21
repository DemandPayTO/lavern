/**
 * MattersFilesView — Component tests.
 *
 * The file room lists every matter as a folder card, sortable by recent,
 * name, priority (overdue court first), or status; closed files hidden
 * by default.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MattersFilesView from '../starling/MattersFilesView.js';

const INBOX = {
  ok: true,
  tasks: [
    { id: 't1', matterId: 'm2', matterLabel: 'Omar Diallo v Gamma Corp', fileNumber: 'DP-2', title: 'SOD due', source: 'deadline', kind: 'timeline', dueDate: '2026-07-10', isCourt: true, band: 'overdue', status: 'open' },
    { id: 't2', matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441', title: 'Draft reply', source: 'action', kind: 'document', dueDate: '2026-07-30', isCourt: false, band: 'later', status: 'open' },
  ],
  matters: [
    { matterId: 'm1', matterLabel: 'Ana Reyes v Beta Inc', fileNumber: 'SL-441', status: 'active', updatedAt: '2026-07-20T10:00:00Z' },
    { matterId: 'm2', matterLabel: 'Omar Diallo v Gamma Corp', fileNumber: 'DP-2', status: 'active', updatedAt: '2026-07-18T10:00:00Z' },
    { matterId: 'm3', matterLabel: 'Zoe Adams v Delta Ltd', fileNumber: 'DP-3', status: 'complete', updatedAt: '2026-07-19T10:00:00Z' },
  ],
  counts: { overdue: 1, today: 0, week: 0, later: 1, none: 0, done: 0 },
};

function cardOrder(): string[] {
  const region = screen.getByLabelText('All files');
  return Array.from(region.querySelectorAll('[role="listitem"]')).map(el => el.textContent ?? '');
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/tasks') return { ok: true, json: async () => INBOX } as Response;
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }));
});

describe('MattersFilesView', () => {
  it('renders open files as folder cards, closed hidden by default', async () => {
    render(<MattersFilesView />);
    await waitFor(() => expect(screen.getByText('Ana Reyes v Beta Inc')).toBeInTheDocument());
    expect(screen.getByText('Omar Diallo v Gamma Corp')).toBeInTheDocument();
    expect(screen.queryByText('Zoe Adams v Delta Ltd')).not.toBeInTheDocument(); // closed
    // Most recent first by default
    expect(cardOrder()[0]).toContain('Ana Reyes');
    // The overdue-court matter flags it
    expect(screen.getByText(/1 overdue · court/)).toBeInTheDocument();
  });

  it('show-closed reveals closed files; sorts by name and priority', async () => {
    render(<MattersFilesView />);
    await waitFor(() => expect(screen.getByText('Ana Reyes v Beta Inc')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText(/Show closed files/i));
    expect(screen.getByText('Zoe Adams v Delta Ltd')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Sort files'), 'name');
    expect(cardOrder()[0]).toContain('Ana Reyes');
    expect(cardOrder()[2]).toContain('Zoe Adams');

    await userEvent.selectOptions(screen.getByLabelText('Sort files'), 'priority');
    expect(cardOrder()[0]).toContain('Omar Diallo'); // overdue court work first
  });

  it('search narrows by name or file number', async () => {
    render(<MattersFilesView />);
    await waitFor(() => expect(screen.getByText('Ana Reyes v Beta Inc')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Search files'), 'SL-441');
    expect(screen.getByText('Ana Reyes v Beta Inc')).toBeInTheDocument();
    expect(screen.queryByText('Omar Diallo v Gamma Corp')).not.toBeInTheDocument();
  });

  it('opens the matter on card click', async () => {
    render(<MattersFilesView />);
    await waitFor(() => expect(screen.getByText('Ana Reyes v Beta Inc')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Open file SL-441: Ana Reyes v Beta Inc'));
    expect(window.location.hash).toBe('#/matter-detail/m1');
  });
});
