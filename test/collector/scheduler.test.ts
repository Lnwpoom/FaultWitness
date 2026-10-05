// The Collector's scheduler, on fake timers: a Round every cadence, never two at once, pausable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../../src/collector/index.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A tick that takes `ms` to finish, counting how many ran and how many overlapped. */
function slowTick(ms: number) {
  const stats = { started: 0, running: 0, maxRunning: 0 };
  const tick = () => {
    stats.started++;
    stats.running++;
    stats.maxRunning = Math.max(stats.maxRunning, stats.running);
    return new Promise<void>((resolve) => setTimeout(() => {
      stats.running--;
      resolve();
    }, ms));
  };
  return { stats, tick, busy: () => stats.running > 0 };
}

describe('Collector scheduler', () => {
  it('runs a Round at start and then every cadence', async () => {
    const { stats, tick, busy } = slowTick(100);
    const s = createScheduler({ intervalMs: 10_000, tick, busy });
    s.start();
    expect(stats.started).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stats.started).toBe(4);
    s.stop();
  });

  it('skips a tick while a Round is still running, so Rounds never overlap', async () => {
    const { stats, tick, busy } = slowTick(25_000);
    const s = createScheduler({ intervalMs: 10_000, tick, busy });
    s.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stats.maxRunning).toBe(1);
    // t=0 runs until 25 s, so 10 s and 20 s are skipped; 30 s runs until 55 s, so 40 s and 50 s are skipped; 60 s runs
    expect(stats.started).toBe(3);
    s.stop();
  });

  it('stops ticking while paused and resumes on the next cadence', async () => {
    const { stats, tick, busy } = slowTick(10);
    const s = createScheduler({ intervalMs: 10_000, tick, busy });
    s.start();
    s.setPaused(true);
    expect(s.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(stats.started).toBe(1);
    s.setPaused(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stats.started).toBe(2);
    s.stop();
  });

  it('reports a failed Round instead of throwing', async () => {
    const errors: unknown[] = [];
    const s = createScheduler({ intervalMs: 10_000, tick: () => Promise.reject(new Error('boom')), busy: () => false, onError: (e) => errors.push(e) });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    s.stop();
  });
});
