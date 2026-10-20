# 3 — What the output should look like

What a correct run produces, so you can tell success from a silent failure. The reference values
are the ones the manuscript reports; the datasets behind them are in
[`../validation/results/`](../validation/results/), so you can compare against the actual runs
rather than against prose.

## E1 — substrate neutrality

`output_digests.py` prints one line per file and a summary. A correct run gives near-total
agreement, not perfect agreement:

| | reference run |
|---|---|
| tasks per arm | 636, no failures |
| result tables compared | 283 |
| tables agreeing | 281 |
| bit-identical | 279 |
| identical after normalising run-stamped fields | 2 |

The two non-identical tables are expected. They carry timestamps and run identifiers that differ
between any two executions, including two runs of the same arm. What matters is that the joint
variant table, the mapping and variant statistics, the strain classification and the phylogeny
all agree.

**If more than two tables differ**, something other than the executor changed. Check that both
arms used the same container digests and the same reference data before concluding anything
about `nf-nomad`.

A useful control: run the pipeline serially and in parallel on one machine, with no orchestrator
at all. The same two-table signature appears, which places the difference in parallel alignment
rather than in the executor.

## E1 timing

| | reference run |
|---|---|
| samples | 5 |
| tasks per arm | 41 |
| walltime, local executor | 2,989 s |
| walltime, `nf-nomad` | 2,863 s |

Expect these to be close, in either direction. The claim is that dispatching through a scheduler
costs no measurable walltime at this task granularity, not that `nf-nomad` is faster. A single
paired run cannot support a speed claim, and the manuscript does not make one.

## X4 — placement latency

| | median | p95 |
|---|---|---|
| local executor | 0.077 s | 0.091 s |
| `nf-nomad` | 4.802 s | 40.864 s |

The gap is the cost of submitting each task to a scheduler and waiting for placement. It is a
per-task cost, so it is negligible for long tasks and material for very short ones. Seeing a
median in this range is the expected result, not a problem.

## E3 — preemption recovery

| | reference run |
|---|---|
| trials | 9, across two task-retry configurations |
| recovered | 9 of 9, no operator intervention |
| timeouts | 0 |
| median recovery | 15.63 s |
| range | 7.92 to 20.10 s |

`trials.tsv` records one row per trial with the outcome column. Rows marked `NO_DISRUPTION` are
trials where stopping the node did not actually interrupt running work; they are excluded from
the median because they measure nothing. Rows marked `TIMEOUT` mean recovery was not confirmed
within the limit and are reported rather than dropped.

**If you see 0 s or 1 s recoveries**, the cluster was already degraded when the trial started.
Restart it and rerun; the harness guards against this but a cluster left broken by an
interrupted run can still produce the artefact.

## E2 — mode equivalence

Fusion and `nf-nomad-s5cmd` should produce equivalent outputs, with per-mode walltime reported
without claiming either is faster unless the data supports it.

> **Note.** The mode-equivalence result is not yet complete in the reference campaign. The
> configurations and harness are here and are runnable; the comparison itself is outstanding.

## Reading the deposited results

Each directory under `validation/results/` holds the raw artefacts for one experiment, including
trace files, digest manifests and the trial table. They are the evidence behind the numbers
above, and they are deposited so that the paper can be checked rather than taken on trust.
