/**
 * Unit Tests — retrying a transient upstream failure.
 *
 * Overload is the case that matters. The generic policy gave up on a 529 after
 * roughly three seconds, which is far shorter than an overload lasts: it cost
 * a verification run twice in one day, and reaches a lawyer mid-draft as
 * "Document generation failed. Please try again."
 *
 * Timers are faked, so these assert the ramp without waiting for it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, isRetryableError, isOverloadError } from '../../src/utils/with-retry.js';

/** Run a retrying call to completion under fake timers, collecting the delays. */
async function runWithDelays<T>(fn: () => Promise<T>, opts: Parameters<typeof withRetry>[1] = {}) {
  const delays: number[] = [];
  const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  try {
    const result = await withRetry(fn, opts).then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error }),
    );
    return { ...result, delays };
  } finally {
    spy.mockRestore();
  }
}

const overloaded = () => Object.assign(new Error('Overloaded'), { status: 529 });
const badRequest = () => Object.assign(new Error('Invalid request'), { status: 400 });

beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.5); });
afterEach(() => { vi.restoreAllMocks(); });

describe('isOverloadError', () => {
  it('recognises the status', () => {
    expect(isOverloadError(overloaded())).toBe(true);
  });

  it('recognises the message where no status is attached', () => {
    expect(isOverloadError(new Error('529 {"type":"overloaded_error"}'))).toBe(true);
  });

  it('is not fooled by another transient failure', () => {
    expect(isOverloadError(Object.assign(new Error('Too Many Requests'), { status: 429 }))).toBe(false);
    expect(isOverloadError(badRequest())).toBe(false);
  });

  it('treats a rate limit as retryable but not as overload', () => {
    const rateLimited = Object.assign(new Error('rate limit'), { status: 429 });
    expect(isRetryableError(rateLimited)).toBe(true);
    expect(isOverloadError(rateLimited)).toBe(false);
  });
});

describe('isRetryableError', () => {
  // The SDK raises this with no status attached. It matched nothing, so a
  // network blip threw on the first attempt with no retry at all, and the
  // call site's maxRetries was never consulted.
  it('retries the SDK bare connection error', () => {
    expect(isRetryableError(new Error('Connection error.'))).toBe(true);
  });

  it('retries it by class name even if the message changes', () => {
    const err = new Error('something the SDK reworded');
    err.name = 'APIConnectionError';
    expect(isRetryableError(err)).toBe(true);
  });

  it('retries a connection timeout', () => {
    expect(isRetryableError(new Error('Request timed out.'))).toBe(true);
  });

  it('still refuses an error that is genuinely the request\'s fault', () => {
    expect(isRetryableError(new Error('invalid_request_error: max_tokens too large'))).toBe(false);
  });

  it('treats a connection error as ordinary, not as overload', () => {
    expect(isOverloadError(new Error('Connection error.'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('retries a bare connection error on the ordinary ramp', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Connection error.'))
      .mockResolvedValue('drafted');
    const out = await runWithDelays(fn, { maxRetries: 4 });
    expect(out.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(out.delays).toEqual([1000]);
  });

  it('returns the value without retrying when the call succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await runWithDelays(fn);
    expect(out.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out.delays).toEqual([]);
  });

  it('does not retry a request that was simply wrong', async () => {
    const fn = vi.fn().mockRejectedValue(badRequest());
    const out = await runWithDelays(fn);
    expect(out.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps the ordinary ramp for an ordinary transient failure', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('bad gateway'), { status: 502 }));
    const out = await runWithDelays(fn, { maxRetries: 2 });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(out.delays).toEqual([1000, 2000]);
  });

  // The defect this exists to fix: an overload retried at one and two seconds.
  it('ramps far further on overload than on an ordinary blip', async () => {
    const fn = vi.fn().mockRejectedValue(overloaded());
    const out = await runWithDelays(fn, { maxRetries: 4 });
    expect(out.delays).toEqual([4000, 8000, 16000, 30000]);
    expect(out.delays.reduce((a, b) => a + b, 0)).toBeGreaterThan(55_000);
  });

  // The caller owns its budget: only it knows whether it sits inside a request.
  it('never takes more attempts than the caller allowed', async () => {
    const fn = vi.fn().mockRejectedValue(overloaded());
    await runWithDelays(fn, { maxRetries: 2 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honours an explicit delay cap even on overload', async () => {
    const out = await runWithDelays(vi.fn().mockRejectedValue(overloaded()), { maxRetries: 2, maxDelayMs: 10 });
    expect(Math.max(...out.delays)).toBeLessThanOrEqual(10);
  });

  it('caps the overload ramp rather than growing without bound', async () => {
    const fn = vi.fn().mockRejectedValue(overloaded());
    const out = await runWithDelays(fn, { maxRetries: 8 });
    expect(Math.max(...out.delays)).toBeLessThanOrEqual(30_000);
  });

  it('succeeds once capacity returns partway through', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(overloaded())
      .mockRejectedValueOnce(overloaded())
      .mockResolvedValue('drafted');
    const out = await runWithDelays(fn, { maxRetries: 2 });
    expect(out.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the upstream error when the ramp is exhausted', async () => {
    const err = overloaded();
    const out = await runWithDelays(vi.fn().mockRejectedValue(err), { maxRetries: 2 });
    expect(out.ok).toBe(false);
    expect((out as { error: unknown }).error).toBe(err);
  });

  // Without jitter a batch of concurrent calls retries in lockstep and
  // collides again on the beat that was already congested.
  it('jitters the delay rather than retrying on the exact beat', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const low = await runWithDelays(vi.fn().mockRejectedValue(overloaded()), { maxRetries: 1 });
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const high = await runWithDelays(vi.fn().mockRejectedValue(overloaded()), { maxRetries: 1 });
    expect(low.delays[0]).toBe(3000);
    expect(high.delays[0]).toBe(5000);
  });
});
