/**
 * StarlingDashboard — logout control.
 *
 * The dashboard header shows a "Log out" button only when an authenticated
 * user is in context (auth-enabled deployments); in LOCAL MODE there is no
 * UserContext provider, so nothing renders. Clicking it calls userCtx.logout.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserContext, type AuthUser, type UserContextValue } from '../auth/UserContext.js';

// Stub the data hooks so the dashboard renders without a backend.
vi.mock('../starling/hooks/useStarlingApi.js', () => ({
  useMatterList: () => ({ matters: [], loading: false, refresh: vi.fn() }),
  usePracticeMode: () => 'employment',
}));

import StarlingDashboard from '../starling/StarlingDashboard.js';

const user: AuthUser = {
  id: 'u1', email: 'jane@smithlaw.ca', displayName: 'Jane Smith',
  firmName: 'Smith Law', profile: {}, emailVerified: true,
};

function renderWith(ctx: UserContextValue | null) {
  return render(
    ctx
      ? <UserContext.Provider value={ctx}><StarlingDashboard /></UserContext.Provider>
      : <StarlingDashboard />,
  );
}

describe('StarlingDashboard logout control', () => {
  it('renders a Log out button and the signed-in name when a user is present', () => {
    renderWith({ user, login: vi.fn(), logout: vi.fn() });
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('calls logout when the button is clicked', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    renderWith({ user, login: vi.fn(), logout });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it('renders no logout control in LOCAL MODE (no provider)', () => {
    renderWith(null);
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });
});
