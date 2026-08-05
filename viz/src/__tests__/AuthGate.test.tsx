/**
 * Component Tests — the gate must always open.
 *
 * The gate shows a loading mark while it asks the API who the user is.
 * Every path out of that check has to clear the flag, including the paths
 * where no request is made at all: a gate that never opens is a blank
 * product, and it fails silently with no error in the console.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

async function renderGate(standalone: boolean) {
  vi.resetModules();
  vi.doMock('../standalone.js', () => ({ IS_STANDALONE: standalone }));
  const { AuthGate } = await import('../auth/AuthGate.js');
  render(<AuthGate><div>the dashboard</div></AuthGate>);
}

describe('AuthGate', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.doUnmock('../standalone.js'); });

  it('opens with no backend to ask (standalone: vite dev at /, static deploys)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await renderGate(true);
    expect(await screen.findByText('the dashboard')).toBeTruthy();
    // Nothing to ask, so nothing is asked.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens as the local user when the auth routes are not registered', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }),
    );
    await renderGate(false);
    expect(await screen.findByText('the dashboard')).toBeTruthy();
  });

  it('opens even when the server never answers', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await renderGate(false);
    await waitFor(() => expect(screen.getByText('the dashboard')).toBeTruthy());
  });
});
