# The Collector pulls Results from the Probes

The prototype's wording implies Probes push Results to the Collector on their own schedule. We invert it: each Probe exposes an HTTP endpoint that runs a given list of tests and returns the Results, and the Collector calls both Probes to run a Round. Follow-up Tests need every Probe's HTTP Results before they can be planned, and with the Collector in charge that is one function call between two requests instead of a round-matching protocol with synchronised clocks. A Probe that does not answer within the timeout simply contributes no Results, which the Diagnosis already reports as Insufficient Data.

## Consequences

The next-step text for a silent Probe changes from "check that the Probe can reach the Collector's port" to "check that the Collector can reach the Probe's port".
