/**
 * AuthGate — Transparent auth wrapper.
 *
 * Always renders children (the app). Provides UserContext with
 * the current user (or null) plus login/logout functions.
 *
 * In standalone mode: skips auth check entirely, renders immediately.
 */

import { useState, useEffect, useCallback } from 'react';
import { UserContext, type AuthUser } from './UserContext.js';
import { IS_STANDALONE } from '../standalone.js';
import { colors, fonts } from '../staffing/styles/tokens.js';
import { StarlingWordmark } from '../components/StarlingWordmark.js';

interface Props {
  children: React.ReactNode;
}

export function AuthGate({ children }: Props) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  // Check for existing session on mount (API mode only)
  useEffect(() => {
    // Standalone has no backend to ask, so there is nothing to check. It
    // still has to SAY so: returning without clearing the flag leaves the
    // gate on its loading mark forever, which is what `vite dev` at / and
    // any static deploy did. Production escapes it only because it is
    // served from /dashboard/.
    if (IS_STANDALONE) {
      setChecking(false);
      return;
    }

    // 5-second timeout prevents indefinite loading on slow/unresponsive server
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch('/api/auth/me', { credentials: 'include', signal: controller.signal })
      .then(r => {
        if (r.status === 404) {
          // Auth routes not registered (LOCAL MODE) — inject synthetic user
          return { user: { id: 'local-user', email: 'local@localhost', displayName: 'Local User', firmName: '', profile: {}, emailVerified: true } };
        }
        return r.ok ? r.json() : null;
      })
      .then(data => {
        setUser(data?.user ?? null);
        setChecking(false);
      })
      .catch(() => {
        // Network error or timeout — fall back to local-user so app is usable
        setUser({ id: 'local-user', email: 'local@localhost', displayName: 'Local User', firmName: '', profile: {}, emailVerified: true });
        setChecking(false);
      })
      .finally(() => clearTimeout(timeout));
  }, []);

  const login = useCallback((u: AuthUser) => {
    setUser(u);
    // Clear any demo session so real API calls are used going forward
    sessionStorage.removeItem('shem-session-id');
    sessionStorage.removeItem('shem-demo-case');
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    setUser(null);
    // Don't redirect away from auth-free routes
    if (!window.location.hash.startsWith('#/claw-live')) {
      window.location.hash = '';
    }
  }, []);

  // Brief loading flash while checking cookie (API mode only)
  if (checking) {
    return (
      <div style={loadingStyles.wrap}>
        <div style={loadingStyles.text}><StarlingWordmark color={colors.textDim} /></div>
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ user, login, logout }}>
      {children}
    </UserContext.Provider>
  );
}

const loadingStyles: Record<string, React.CSSProperties> = {
  wrap: {
    width: '100%',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  text: {
    fontFamily: fonts.serif,
    fontSize: 24,
    fontWeight: 300,
    color: colors.textDim,
    letterSpacing: 8,
  },
};
