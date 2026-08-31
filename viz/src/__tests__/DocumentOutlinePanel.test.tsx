/**
 * DocumentOutlinePanel — Component tests.
 *
 * The one section-by-section workspace, shared by the claim, the factum and
 * the mediation brief. It replaced three near-identical panels that had no
 * tests at all, which is what made them risky to touch. These cover the
 * behaviour each of the three relied on, so the next document to adopt the
 * panel inherits the coverage.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DocumentOutlinePanel,
  type OutlineSectionUI,
} from '../starling/matter/workspaces/DocumentOutlinePanel.js';

function section(over: Partial<OutlineSectionUI> = {}): OutlineSectionUI {
  return {
    id: 'S1',
    header: 'Overview',
    html: '<p>The applicant was dismissed.</p>',
    status: 'drafted',
    approved: false,
    readable: true,
    draftable: true,
    hasDraft: true,
    discardLabel: 'Discard',
    ...over,
  };
}

function panel(over: Partial<Parameters<typeof DocumentOutlinePanel>[0]> = {}) {
  const props = {
    title: 'Draft the brief section by section',
    description: 'Each section of the narrative, in order.',
    editHint: 'Paragraph numbers are added when the brief assembles.',
    sections: [section()],
    approveSection: vi.fn().mockResolvedValue(undefined),
    saveSection: vi.fn().mockResolvedValue(undefined),
    clearSection: vi.fn().mockResolvedValue(undefined),
    draftSection: vi.fn().mockResolvedValue(undefined),
    busyId: null,
    ...over,
  };
  render(<DocumentOutlinePanel {...props} />);
  return props;
}

describe('DocumentOutlinePanel', () => {
  it('shows the document its own title and description', () => {
    panel();
    expect(screen.getByText('Draft the brief section by section')).toBeInTheDocument();
    expect(screen.getByText('Each section of the narrative, in order.')).toBeInTheDocument();
  });

  it('counts approvals only where nothing is drafted wholesale', () => {
    panel({ sections: [section({ approved: true, status: 'approved' }), section({ id: 'S2' })] });
    expect(screen.getByText('1 of 2 approved')).toBeInTheDocument();
  });

  it('counts drafts as well once the document drafts every section', () => {
    panel({
      draftAll: vi.fn().mockResolvedValue(undefined),
      sections: [section({ approved: true, status: 'approved' }), section({ id: 'S2', hasDraft: false, status: 'not_drafted' })],
    });
    expect(screen.getByText('1 of 2 drafted · 1 approved')).toBeInTheDocument();
  });

  // The claim's pleading nodes are readable but never drafted. Counting them
  // as undrafted would read as outstanding work that does not exist.
  it('offers no draft control on a section Starling does not draft', () => {
    panel({ sections: [section({ draftable: false, status: 'as_pleaded' })] });
    expect(screen.queryByRole('button', { name: /draft/i })).not.toBeInTheDocument();
    expect(screen.getByText('AS PLEADED')).toBeInTheDocument();
  });

  it('reads draft before a draft exists', () => {
    panel({ sections: [section({ hasDraft: false, status: 'not_drafted', readable: false })] });
    expect(screen.getByRole('button', { name: 'draft' })).toBeInTheDocument();
  });

  it('reads redraft once a draft exists', () => {
    panel({ sections: [section({ hasDraft: true })] });
    expect(screen.getByRole('button', { name: 'redraft' })).toBeInTheDocument();
  });

  it('opens and hides the section body', async () => {
    const user = userEvent.setup();
    panel();
    await user.click(screen.getByRole('button', { name: 'read' }));
    expect(screen.getByText('The applicant was dismissed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'hide' }));
    expect(screen.queryByText('The applicant was dismissed.')).not.toBeInTheDocument();
  });

  it('approves a section, and offers to reopen it afterwards', async () => {
    const user = userEvent.setup();
    const props = panel();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(props.approveSection).toHaveBeenCalledWith('S1', true);
  });

  it('reopens an approved section rather than offering Approve twice', async () => {
    const user = userEvent.setup();
    const props = panel({ sections: [section({ approved: true, status: 'approved' })] });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reopen/ }));
    expect(props.approveSection).toHaveBeenCalledWith('S1', false);
  });

  it('edits a section by hand and saves the edited text', async () => {
    const user = userEvent.setup();
    const props = panel();
    await user.click(screen.getByRole('button', { name: 'read' }));
    await user.click(screen.getByRole('button', { name: 'edit by hand' }));
    const box = screen.getByRole('textbox', { name: /Edit Overview/ });
    await user.clear(box);
    await user.type(box, '<p>Edited.</p>');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.saveSection).toHaveBeenCalledWith('S1', '<p>Edited.</p>');
  });

  it('shows the document its own note about where numbering comes from', async () => {
    const user = userEvent.setup();
    panel({ editHint: 'Paragraph numbers are added when the claim assembles.' });
    await user.click(screen.getByRole('button', { name: 'read' }));
    await user.click(screen.getByRole('button', { name: 'edit by hand' }));
    expect(screen.getByText('Paragraph numbers are added when the claim assembles.')).toBeInTheDocument();
  });

  it('refuses to save an empty edit', async () => {
    const user = userEvent.setup();
    const props = panel();
    await user.click(screen.getByRole('button', { name: 'read' }));
    await user.click(screen.getByRole('button', { name: 'edit by hand' }));
    await user.clear(screen.getByRole('textbox', { name: /Edit Overview/ }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(props.saveSection).not.toHaveBeenCalled();
  });

  it('names the discard control as the document names it', async () => {
    const user = userEvent.setup();
    const props = panel({ sections: [section({ discardLabel: 'Revert to standard' })] });
    await user.click(screen.getByRole('button', { name: 'read' }));
    await user.click(screen.getByRole('button', { name: 'Revert to standard' }));
    expect(props.clearSection).toHaveBeenCalledWith('S1');
  });

  it('offers nothing to discard where the section carries no discard label', async () => {
    const user = userEvent.setup();
    panel({ sections: [section({ discardLabel: undefined })] });
    await user.click(screen.getByRole('button', { name: 'read' }));
    expect(screen.queryByRole('button', { name: /Discard|Revert/ })).not.toBeInTheDocument();
  });

  it('carries the factum its part label, and a section its own notes', () => {
    panel({
      sections: [section({
        prefix: 'Part III',
        suffix: 'your section',
        detail: 'Waksdale v Swegon',
        notes: ['3 blanks to fill'],
      })],
    });
    expect(screen.getByText('PART III')).toBeInTheDocument();
    expect(screen.getByText(/your section/)).toBeInTheDocument();
    expect(screen.getByText('Waksdale v Swegon')).toBeInTheDocument();
    expect(screen.getByText('3 blanks to fill')).toBeInTheDocument();
  });

  it('summarises review flags on the row and lists them when opened', async () => {
    const user = userEvent.setup();
    panel({ sections: [section({ reviewFlags: ['Check the limitation date', 'Confirm the grounds'] })] });
    expect(screen.getByText('2 things to check')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'read' }));
    expect(screen.getByText('Check the limitation date')).toBeInTheDocument();
  });

  it('says one thing to check rather than 1 things', () => {
    panel({ sections: [section({ reviewFlags: ['Check the limitation date'] })] });
    expect(screen.getByText('1 thing to check')).toBeInTheDocument();
  });

  it('offers nothing to read on a section with no text yet', () => {
    panel({ sections: [section({ readable: false, hasDraft: false, status: 'not_drafted' })] });
    expect(screen.queryByRole('button', { name: 'read' })).not.toBeInTheDocument();
  });

  // A pleading node is readable but can still render empty once its
  // conditionals resolve away, so the body is gated on the text and not on the
  // flag. Without that the row opened onto nothing at all.
  it('explains an empty body in the document its own words', async () => {
    const user = userEvent.setup();
    panel({
      sections: [section({
        html: '   ',
        emptyText: 'Not drafted yet. Use draft to write the Background Facts.',
      })],
    });
    await user.click(screen.getByRole('button', { name: 'read' }));
    expect(screen.getByText('Not drafted yet. Use draft to write the Background Facts.')).toBeInTheDocument();
  });

  it('disables every control while a section is drafting', () => {
    panel({ busyId: 'S1' });
    expect(screen.getByRole('button', { name: 'drafting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('drafts every section from one control, and says so while it runs', async () => {
    const user = userEvent.setup();
    const draftAll = vi.fn().mockResolvedValue(undefined);
    panel({ draftAll, sections: [section({ hasDraft: false, status: 'not_drafted' })] });
    await user.click(screen.getByRole('button', { name: 'Draft all sections' }));
    expect(draftAll).toHaveBeenCalled();
  });

  it('offers to draft only what is missing once something is drafted', () => {
    panel({ draftAll: vi.fn(), sections: [section()] });
    expect(screen.getByRole('button', { name: 'Draft any not yet drafted' })).toBeInTheDocument();
  });

  it('shows no draft-everything control where the document has none', () => {
    panel();
    expect(screen.queryByRole('button', { name: /Draft all|Draft any/ })).not.toBeInTheDocument();
  });
});
