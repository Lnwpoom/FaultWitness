# FaultWitness

Collects test results from several vantage points on a network and turns them into an explainable verdict on where a connectivity problem lies. It reports evidence and gaps, and never guesses a cause the evidence does not support. User-facing text is Thai; the Thai label in brackets is the word shown on screen.

## Vantage points and destinations

**Probe** [Probe / จุดตรวจ]:
A machine on the network that runs tests on request and returns their results. There are exactly two, named A and B; each is the other's comparison evidence.
_Avoid_: Agent, sensor, node

**Collector** [เครื่องหลัก]:
The machine that starts each Round, gathers Results from the Probes and produces the Diagnosis.
_Avoid_: Server, controller, master

**Target** [ปลายทาง]:
A destination the Probes test. There are exactly three: the Internal Service and two External Sites.
_Avoid_: Host, endpoint, site (on its own)

**Internal Service** [บริการภายใน]:
The Target inside the network under test, used to tell "the inside works" apart from "the way out works".
_Avoid_: Local server, intranet

**External Site** [เว็บไซต์ X / Y]:
A Target outside the network under test, reached by hostname over HTTPS, with a fixed IP known in advance for path tests.
_Avoid_: Internet, remote host

## Testing

**Round** [รอบ]:
One coordinated pass in which both Probes test the Targets at the same time, identified by a single round id issued by the Collector.
_Avoid_: Cycle, sweep, run

**Result** [ผลการตรวจ]:
One row recording a single test (HTTP, DNS or TCP) from one Probe to one Target in one Round: success, duration and error type.
_Avoid_: Measurement, sample, log entry

**Follow-up Test** [ตรวจต่อตามอาการ]:
A DNS or TCP test run in the same Round only for an External Site whose HTTP test failed somewhere, on every Probe that reported. Saves tests compared with a Full Sweep.
_Avoid_: Stage 2, deep check

**Full Sweep** [ตรวจทุกอย่าง]:
The hypothetical test count if every Probe ran every test on every Target each Round; the baseline Follow-up Tests are compared against.

**Path State** [สถานะเส้นทาง]:
What one Probe's Results say about one Target in a Round: reachable, naming broken, server answered wrongly, unreachable, not followed up, or no result.

## Verdicts

**Diagnosis** [ผลวิเคราะห์]:
The report produced from all stored Results: an overall Status for the latest Round plus its Findings and Observations.
_Avoid_: Analysis, verdict, alert

**Finding** [ข้อสรุป]:
One explained conclusion within a Diagnosis: a Status, the supporting evidence, what is still unknown, and next steps.
_Avoid_: Issue, incident, problem

**Status** [สถานะ]:
The category a Finding falls into: normal, Probe-local problem, DNS fault, shared external problem, one Target faulty, or insufficient data.
_Avoid_: Severity, state

**Insufficient Data** [ข้อมูลยังไม่พอ]:
The Status given when the Results match no rule, conflict, are stale, or a Probe sent nothing. FaultWitness says this rather than guess.
_Avoid_: Unknown, error

**Evidence Level** [ระดับหลักฐาน]:
How strongly a Finding is supported: initial (seen this Round only), repeated (seen in consecutive Rounds), or confirmed (repeated and corroborated by the other Probe).
_Avoid_: Confidence, certainty, severity

**Witness** [พยาน]:
A Target or Probe whose success in the same Round is the evidence that a failure elsewhere is local rather than shared.

**Observation** [ข้อสังเกต]:
A noteworthy pattern that is not a fault on its own, such as one Probe being consistently slower while every test still passes.
_Avoid_: Warning, finding

**Stale** [ผลเก่า]:
A Result older than the staleness limit. A Diagnosis never presents stale Results as the current state.

## Lab

**Lab** [ห้องแล็บ]:
A self-contained replica of a network under test, with its own Probes, Targets, resolver and gateway, where Faults can be created on demand and repeated exactly.
_Avoid_: Testbed, sandbox, simulation

**Fault** [เหตุขัดข้อง]:
A problem deliberately created in the lab, such as a broken resolver or a blocked route. The Collector never sees Faults, only Results.
_Avoid_: Error, failure, incident

**Scenario** [สถานการณ์]:
A scripted sequence of Faults with the Finding each one is expected to produce, used to score the Diagnosis against ground truth.
_Avoid_: Test case, fixture
