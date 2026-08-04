/**
 * Lazy view loading that survives a deploy.
 *
 * Every view is a code-split chunk with a content hash in its filename. When
 * a new build ships, the old chunk files are gone: an already-open tab is
 * still running the previous index.html, so the first navigation asks for a
 * chunk that now 404s, the dynamic import rejects, and the error boundary
 * shows "Something unexpected happened" until the lawyer reloads.
 *
 * That is a stale tab, not a fault in the app, and it should recover itself.
 * On a failed chunk fetch we reload once, which pulls the new index.html and
 * the new chunk names. A sessionStorage guard means a genuine, repeatable
 * import failure surfaces as an error instead of looping the page forever.
 */

import { lazy, type ComponentType } from 'react';

const RELOAD_GUARD_KEY = 'starling:chunk-reload-at';
/** Two reloads inside this window means reloading is not fixing it. */
const GUARD_WINDOW_MS = 30_000;

/** A failed dynamic import, across browsers. Chrome, Safari and Firefox all
 *  word this differently, and a bare 404 shows up as a parse/MIME error. */
function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Failed to fetch/i
    .test(message);
}

// Matches React.lazy's own constraint: views take their own props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyView<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() => factory().then(
    (mod) => {
      // A successful load means this tab is current; clear the guard so a
      // later deploy gets its own reload allowance.
      try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* private mode */ }
      return mod;
    },
    (error: unknown) => {
      if (!isChunkLoadFailure(error)) throw error;

      let lastReload = 0;
      try { lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0); } catch { /* private mode */ }

      if (Date.now() - lastReload < GUARD_WINDOW_MS) {
        // Already tried reloading and it still fails: this is not staleness.
        throw error;
      }

      try { sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); } catch { /* private mode */ }
      window.location.reload();
      // Hold the import pending: the page is on its way out, and resolving
      // or rejecting here would flash the error screen before it goes.
      return new Promise<{ default: T }>(() => { /* never settles */ });
    },
  ));
}
