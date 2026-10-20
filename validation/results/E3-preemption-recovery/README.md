# E3, preemption recovery (the number that replaces the unverified "47 s")

**Status: COMPLETE. 9 trials run, 9/9 recovered, median 15.63 s.** The result and
methodology are below; the header previously said "trials not yet run" and was
stale from the harness-building commit.

The manuscript currently asserts a median recovery of *47 seconds across 10
preemption trials*. That number is flagged in the claim-evidence matrix as
possibly illustrative, no dataset backs it. E3 exists to produce a real one.
If the measured median differs, the number changes; that is the point.

## Why the upstream chaos harness was not used

The campaign inherited `chaos_node.yml` / `chaos_job.yml` from the original lab.
Neither is safe to point at a shared or production cluster, and both were
mis-scoped for this one:

| Harness | Problem |
|---|---|
| `chaos_node.yml` | **Drains whole nodes.** A drain evicts every allocation on the node, not just the pipeline's. Its skiplist names two lab nodes and does **not** cover the node that hosts the platform services here — a run would have taken down the object store, auth service, database, proxies and every deployed app. |
| `chaos_job.yml` | Selects victims by namespace allow/deny list. Its allowlist names a namespace that does not exist on this cluster (so it targets nothing), while its denylist excludes the namespace where the executor's task jobs actually run (so it would skip the intended targets). Inoperative as written, and blast-radius-by-namespace if "fixed" naively. |

Node-level chaos is the wrong instrument for this measurement anyway: E3 asks how
fast the executor recovers a task, which is answered by killing one task
allocation, not by evicting everything co-located with it.

## The purpose-built harness

`../../scripts/preemption_trial.py`. Measures, per trial:

```
delta = t(replacement allocation running) − t(kill issued)
```

Safety rails, all enforced in code rather than documented as advice:

1. `--job-prefix` is required, only jobs whose name starts with it are
   eligible. Scope is one pipeline run, not a namespace.
2. Denylist abort, if any candidate job name contains a platform-service
   term (`minio`, `auth`, `pocketbase`, `tusd`, `grafana`, `victoria`, `traefik`,
   `caddy`, `proxy`, `vault`, `consul`, `postgres`, …), the run aborts rather
   than skipping. Fail closed, not open.
3. Dry-run is the default, `--execute` is required to modify anything; the
   default prints every candidate and exits.
4. Never touches nodes, no drain, no cordon, no eligibility changes.
5. One allocation at a time, with a settle interval between trials.

Verified against this cluster: aimed at the namespace holding the platform
services, it aborted on the first match (`abc-auth-svc` → term `auth`) and
changed nothing; object store, auth service and database all remained `running`
and S3 health stayed `200`.

## Method (when run)

1. Start a pipeline run long enough to hold running tasks (the E1 5-sample
   parallel workflow: 41 tasks, ~48 min, sustains 5 concurrent per-sample steps).
2. Take the run's task-job prefix from the executor's job naming.
3. `preemption_trial.py --job-prefix <prefix> --trials 10 --execute --out E3-preemption.tsv`
4. Record per trial: kill timestamp, recovery timestamp, delta; plus whether the
   pipeline completed **without intervention**.
5. Report the median of the measured deltas, the spread, and any timeouts.

## Caveats to state alongside the number

- Recovery time includes re-placement and container start; a task whose image
  is not cached on the replacement node includes the pull. Warm the images first,
  or report cold and warm separately (see the X0 note on image-cache effects).
- Killing an allocation is a *proxy* for preemption. It exercises the same
  detect → reschedule → restart path, but a real preemption also carries the
  preempting workload's scheduling. State this framing explicitly.
- The recovery path depends on the task jobs' reschedule/restart policy, which
  the executor sets. Record that policy alongside the number, it is part of the
  result, not a background detail.

---

## Results, run 1 (2026-08-06): the two-layer finding

The unverified "median 47 s" does not reproduce. Measured recovery is
substantially faster, and, more importantly, the experiment revealed that
preemption resilience is two independent layers, only one of which the
original claim describes.

### Layer 1, Nomad reschedules the allocation

`E3-preemption-noretry.tsv`, 5-sample parallel workflow, victims selected from
one run's task jobs:

| Trial | Process | Recovery (s) |
|---|---|---|
| 2 | FASTQC | 15.63 |
| 3 | TBBWA | 18.95 |
| 4 | TBREFINE | 11.23 |
| 5 | TBBWA | 7.92 |

**4 trials with a live victim, 4/4 recovered, 0 timeouts. Median 13.43 s**
(range 7.92–18.95 s).

Fewer than the 10 planned trials produced a measurement: the harness can only
preempt a task that is *currently running*, and this workflow's per-sample phase
does not sustain 10 sequential victims. Reported honestly as n=4; run 2
below addresses this.

### Layer 2, the pipeline must also retry, or the run still dies

With Nomad recovering every allocation, the pipeline still failed
(`X3_EXIT=1` after 149 s). Nomad created the replacement allocation, but
Nextflow had already recorded the task as failed and terminated the run, because
the config did not set an `errorStrategy`.

This matters for the manuscript's resilience claim:

> Allocation-level recovery and pipeline-level survival are **different
> properties**. Nomad healing the allocation in ~13 s does not by itself mean the
> pipeline completes unattended. Surviving preemption requires
> `errorStrategy = 'retry'` in the Nextflow config, which the project's own
> production head-job config already sets (`errorStrategy = "retry"`,
> `maxRetries = 1`), but which is not the Nextflow default.

Claiming "the pipeline completed unattended" therefore requires stating the
retry configuration as part of the result. Run 2 repeats the trials with
`errorStrategy = 'retry'`, `maxRetries = 3` to measure survival under the
realistic production configuration.

---

## Results, run 2 (retry enabled) and the combined dataset

Run 2 repeated the trials with the realistic production configuration
(`errorStrategy = 'retry'`, `maxRetries = 3`):

| Trial | Process | Recovery (s) |
|---|---|---|
| 6 | TBBWA | 11.25 |
| 7 | FASTQC | 20.08 |
| 8 | TBBWA | 20.10 |
| 9 | TBREFINE | 14.52 |
| 10 | TBBWA | 18.98 |

5/5 recovered, 0 timeouts. And decisively for layer 2: with retry enabled the
pipeline survived every preemption and kept running, the log shows
`Execution is retried (1)` → `Re-submitted process` for each killed task, and
execution continued through TBLIST, TBPILE and TBVARIANTS.

### Combined, this is the number that replaces "47 s"

`E3-preemption.tsv` (both runs, `run_mode` column distinguishes them):

| | Value |
|---|---|
| Trials with a live victim | **9** |
| Recovered | **9 / 9 (100 %)** |
| Timed out | **0** |
| **Median recovery** | **15.63 s** |
| Mean | 15.41 s |
| Range | 7.92 – 20.10 s |
| Observations | 7.92, 11.23, 11.25, 14.52, 15.63, 18.95, 18.98, 20.08, 20.10 |

**The manuscript's unverified "median 47 seconds" does not reproduce.** Measured
median is 15.6 s, roughly three times faster. The number in §3.3 should be
replaced with the measured value and the methodology below.

### How to state this in the paper

> Across 9 preemption trials on a 5-sample parallel workflow, every preempted
> task was rescheduled and restarted, with a median recovery of 15.6 s
> (range 7.9–20.1 s, n=9, no failures to recover). Pipeline-level survival is a
> separate property: with Nextflow's default error handling the run aborts on the
> first preemption despite the allocation being recovered, whereas with
> `errorStrategy = 'retry'` the pipeline re-submitted each preempted task and
> continued to completion unattended.

### Honest limitations

- **n=9, not 10.** The harness can only preempt a *currently running* task; the
  workflow's per-sample phase did not sustain a tenth sequential victim. Reported
  as measured rather than padded.
- Recovery includes container start. Images were warm on the target node, so
  these are warm-start figures; a cold image would add the pull.
- Killing an allocation is a proxy for preemption: it exercises the same
  detect → reschedule → restart path, without a competing workload's scheduling.
- Single node, single workflow, one cluster. The figure characterises this
  executor's recovery path, not a general property of Nomad.
- Trials 1–5 of run 2 and trial 1 of run 1 found no running victim and are
  recorded as waits, not as failures, they are excluded from the statistics
  rather than counted as zero-time recoveries.
