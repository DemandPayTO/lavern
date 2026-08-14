/**
 * Unit Tests — the auth/bind deploy guard.
 *
 * LOCAL MODE (auth off) is correct only on loopback. Binding a public
 * interface with auth off would serve every matter to the network as the
 * synthetic local-user, so the server refuses to start unless the operator
 * acknowledges it. Production (auth on) is never blocked.
 */

import { describe, it, expect } from 'vitest';
import { publicNoAuthBindError } from '../../src/api/server.js';

describe('publicNoAuthBindError', () => {
  it('blocks auth-off on a public interface (the accidental-deploy footgun)', () => {
    const err = publicNoAuthBindError({ authEnabled: false, host: '0.0.0.0', override: false });
    expect(err).toBeTruthy();
    expect(err).toContain('REFUSING TO START');
    expect(err).toContain('LAVERN_AUTH_ENABLED');
  });

  it('allows auth-off on loopback (LOCAL MODE, the intended OSS default)', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(publicNoAuthBindError({ authEnabled: false, host, override: false }), host).toBeNull();
    }
  });

  it('allows a public bind when auth is ON (production)', () => {
    expect(publicNoAuthBindError({ authEnabled: true, host: '0.0.0.0', override: false })).toBeNull();
  });

  it('allows auth-off on a public interface only with the explicit override', () => {
    expect(publicNoAuthBindError({ authEnabled: false, host: '0.0.0.0', override: true })).toBeNull();
  });

  it('treats a LAN address as public, not loopback', () => {
    expect(publicNoAuthBindError({ authEnabled: false, host: '192.168.1.10', override: false })).toBeTruthy();
  });
});
