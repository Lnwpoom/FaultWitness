// Runs a Round every cadence. A tick that comes while a Round is still running is skipped,
// so Rounds never overlap; pausing stops the ticks without forgetting the cadence.

export interface Scheduler {
  start(): void;
  stop(): void;
  setPaused(paused: boolean): void;
  readonly paused: boolean;
}

export interface SchedulerOptions {
  intervalMs: number;
  /** runs one Round; its rejection is reported, never thrown */
  tick: () => Promise<unknown>;
  /** whether a Round is in progress right now (from any trigger) */
  busy: () => boolean;
  onError?: (err: unknown) => void;
}

export function createScheduler({ intervalMs, tick, busy, onError = () => {} }: SchedulerOptions): Scheduler {
  let timer: NodeJS.Timeout | undefined;
  let paused = false;

  const fire = () => {
    if (paused || busy()) return;
    tick().catch(onError);
  };

  return {
    start() {
      if (timer) return;
      fire();
      timer = setInterval(fire, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    setPaused(p) {
      paused = p;
    },
    get paused() {
      return paused;
    },
  };
}
