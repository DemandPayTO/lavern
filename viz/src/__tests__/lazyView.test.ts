/**
 * Tests — deploy-resilient lazy view loading.
 *
 * After a deploy, an already-open tab still points at chunk filenames that
 * no longer exist. The first navigation 404s, the dynamic import rejects,
 * and without this the lawyer sees "Something unexpected happened" and has
 * to reload by hand. These pin the recovery and, just as importantly, that
 * it cannot loop the page.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { lazyView } from '../lazyView.js';

const RELOAD_GUARD_KEY = 'starling:chunk-reload-at';

/** React.lazy defers the factory until render; call it directly instead. */
function invokeFactory(component: ReturnType<typeof lazyView>): Promise<unknown> {
  return (component as unknown as { _payload: { _result: () => Promise<unknown> } })._payload._result();
}

const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('stale chunk recovery', () => {
  it('reloads once when a chunk is missing after a deploy', async () => {
    const staleChunk = () => Promise.reject(
      new TypeError('Failed to fetch dynamically imported module: /dashboard/assets/MatterDetailView-OLDHASH.js'),
    );
    const view = lazyView(staleChunk as never);

    const pending = invokeFactory(view);
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
    // The import must stay pending: settling it would flash the error
    // screen in the instant before the page goes.
    const settled = await Promise.race([pending.then(() => 'settled'), Promise.resolve('pending')]);
    expect(settled).toBe('pending');
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBeTruthy();
  });

  it('does not loop when reloading fails to fix it', async () => {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    const view = lazyView((() => Promise.reject(
      new TypeError('Failed to fetch dynamically imported module: /x.js'),
    )) as never);

    await expect(invokeFactory(view)).rejects.toThrow(/dynamically imported/);
    expect(reload).not.toHaveBeenCalled();
  });

  it('allows a fresh reload once the guard window has passed', async () => {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now() - 60_000));
    const view = lazyView((() => Promise.reject(
      new TypeError('error loading dynamically imported module'),
    )) as never);

    void invokeFactory(view);
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves real application errors alone', async () => {
    const view = lazyView((() => Promise.reject(new Error('Cannot read properties of undefined'))) as never);
    await expect(invokeFactory(view)).rejects.toThrow(/Cannot read properties/);
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears the guard after a successful load', async () => {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    const view = lazyView((() => Promise.resolve({ default: () => null })) as never);
    await invokeFactory(view);
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBeNull();
  });
});
