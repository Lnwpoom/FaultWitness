import type { Report } from '../shared/types.ts';
import type { Diagnosis } from './diagnose.ts';

/** The plain JSON report (`GET /report`, `POST /rounds`) for a Diagnosis, produced at `now` (epoch ms). */
export function toReport(d: Diagnosis, now: number): Report {
  return {
    tool: 'FaultWitness',
    round_id: d.roundId,
    finished_at: d.finishedAt,
    generated_at: now,
    stale: d.stale,
    overall: d.overall,
    alert: d.alert,
    keys: d.keys,
    findings: d.findings.map((f) => ({
      key: f.key,
      code: f.code,
      status: f.status,
      title: f.title,
      evidence_level: f.level,
      evidence_level_label: f.levelLabel,
      rounds_seen: f.streak,
      supporting: f.evidence,
      missing: f.missing,
      next_steps: f.next,
    })),
    observations: d.observations.map((o) => ({
      probe_id: o.probe,
      peer: o.peer,
      ratio: o.ratio,
      text: o.text,
      next_steps: o.next,
    })),
    probes: d.probes.map((p) => ({ probe_id: p.probe, state: p.state, state_label: p.label, last_seen_ms: p.lastSeen })),
    tests_this_round: d.tests,
    tests_if_full_sweep: d.full,
    results: d.rows,
  };
}
