/**
 * Unit Tests — the worklist engine.
 *
 * The properties that make the dashboard trustworthy: a waiting file
 * leaves the needs-me pile, comes back when the wait outruns the nudge
 * window carrying the follow-up as its action, and a matter whose data
 * confuses the engines still lists rather than breaking the list.
 */

import { describe, it, expect } from 'vitest';
import {
  waitingState, topStepOf, nudgeAction, DEFAULT_NUDGE_DAYS, WAITING_LABELS,
} from '../../src/employment/worklist.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('waitingState', () => {
  it('reads a fresh wait: not yet nudged, days counted', () => {
    const w = waitingState({ who: 'opposing_counsel', since: daysAgo(3) });
    expect(w).not.toBeNull();
    expect(w!.days).toBe(3);
    expect(w!.nudged).toBe(false);
    expect(w!.whoLabel).toBe(WAITING_LABELS.opposing_counsel);
    expect(w!.nudgeAfterDays).toBe(DEFAULT_NUDGE_DAYS);
  });

  it('a wait past the window is nudged', () => {
    const w = waitingState({ who: 'client', since: daysAgo(8) });
    expect(w!.nudged).toBe(true);
  });

  it('a custom window is respected and clamped sane', () => {
    expect(waitingState({ who: 'tribunal', since: daysAgo(10), nudgeAfterDays: 14 })!.nudged).toBe(false);
    expect(waitingState({ who: 'tribunal', since: daysAgo(10), nudgeAfterDays: 5 })!.nudged).toBe(true);
  });

  it('garbage returns null, never throws', () => {
    expect(waitingState(null)).toBeNull();
    expect(waitingState('waiting')).toBeNull();
    expect(waitingState({ who: 'the void', since: daysAgo(1) })).toBeNull();
    expect(waitingState({ who: 'client', since: 'not a date' })).toBeNull();
  });
});

describe('topStepOf', () => {
  it('an employment matter with intake gets the engine step and its stage', () => {
    const record = {
      employmentData: {
        intake: {
          client_first_name: 'Aisha', client_last_name: 'Osei',
          employer_legal_name: 'Acme Widgets Ltd', was_terminated: true,
          annual_salary: 92000, hire_date: '2019-09-03', termination_date: '2026-04-20',
        },
        timeline: [], gates: [], approvedIssues: [], dismissedIssues: [],
        documentExtractions: [], analysis: null,
      },
    };
    const step = topStepOf(record);
    expect(step).not.toBeNull();
    expect(step!.action.length).toBeGreaterThan(0);
    expect(['urgent', 'now', 'soon']).toContain(step!.urgency);
    expect(step!.stageLabel.length).toBeGreaterThan(0);
  });

  it('a matter with no intake yields null, not an error', () => {
    expect(topStepOf({})).toBeNull();
    expect(topStepOf({ employmentData: { intake: {} } })).toBeNull();
  });

  it('malformed data never throws: the list survives whatever a record holds', () => {
    const out = topStepOf({ employmentData: { intake: { client_first_name: 'X' }, timeline: 'not an array' } });
    // The engines may still produce a sane step; the pinned property is
    // that a bad record cannot break the whole list.
    if (out !== null) {
      expect(typeof out.action).toBe('string');
      expect(['urgent', 'now', 'soon']).toContain(out.urgency);
    }
  });
});

describe('nudgeAction', () => {
  it('the follow-up carries who and how long', () => {
    const w = waitingState({ who: 'opposing_counsel', since: daysAgo(14) })!;
    const a = nudgeAction(w);
    expect(a.action).toContain('opposing counsel');
    expect(a.action).toContain('14 days');
    expect(a.urgency).toBe('now');
  });
});
