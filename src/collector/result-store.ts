import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Result } from '../shared/types.ts';
import type { Clock } from './ports.ts';

/** The line `reset()` writes to the JSONL file, so the file stays a complete history. */
export interface ResetMarker {
  reset: true;
  /** epoch ms, Collector clock */
  at: number;
}

/** Every Result the Collector has stored since start or the last reset, mirrored to an append-only JSONL file. */
export interface ResultStore {
  append(results: readonly Result[]): void;
  all(): readonly Result[];
  /** Forgets the stored Results and appends a ResetMarker line to the file. */
  reset(): void;
}

export interface ResultStoreOptions {
  /** the JSONL file; created with its directory if missing, never truncated */
  path: string;
  clock: Clock;
}

export function createResultStore({ path, clock }: ResultStoreOptions): ResultStore {
  mkdirSync(dirname(path), { recursive: true });
  let results: Result[] = [];
  const write = (lines: readonly unknown[]) => appendFileSync(path, lines.map((l) => JSON.stringify(l) + '\n').join(''));
  return {
    append(rs) {
      if (!rs.length) return;
      write(rs);
      results.push(...rs);
    },
    all: () => results,
    reset() {
      results = [];
      const marker: ResetMarker = { reset: true, at: clock.now() };
      write([marker]);
    },
  };
}
