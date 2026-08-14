# X0 verification runs, execution metadata

Raw Nextflow execution metadata from the X0 toolchain-verification runs
(2026-08-06). These are not headline results. They verify that the executor,
configs and reporting chain work end to end, and they show how the runtime
numbers in the paper are derived.

Environment: `../S1-environment-profile.md`. Software: nf-nomad 0.5.0-edge3,
Nextflow 26.04.3, Docker task driver, single execution node.
Node hostnames in the HTML reports are replaced with a generic label
(`exec-node-01`); hardware fields (CPU model, core counts) are unmodified.

## Runs

| Tag | Pipeline | Purpose | Result |
|---|---|---|---|
| `t-rnaseq2` | `nextflow-io/rnaseq-nf` | first successful end-to-end run | 4/4 tasks, exit 0, 54 s |
| `t-demo` | `nf-core/demo` (`-r dev -profile test,docker`) | multi-sample, parallel tasks | 8/8 tasks, exit 0, 205 s |
| `t-strict` | `nextflow-io/rnaseq-nf` | confirms the PR #132 strict-parser config syntax (no `NXF_SYNTAX_PARSER` override) | 4/4 tasks, exit 0, 45 s |
| `t-env` | `nextflow-io/rnaseq-nf` | confirms `System.getenv()` resolves under the strict parser | 4/4 tasks, exit 0, 50 s |

Per run: `execution_trace-<tag>.txt` (per-task TSV), `execution_report-<tag>.html`,
`execution_timeline-<tag>.html`. `t-demo/nf-core-results/` additionally carries
nf-core's own provenance, resolved software versions and the run's parameter
snapshot, which is what a methods section should cite for tool versions.

## Derived metrics

`placement-latency-summary.tsv`, produced by `../../scripts/trace_metrics.py`:

| trace | tasks | span (s) | p50 (s) | p95 (s) | max (s) |
|---|---|---|---|---|---|
| `t-demo` | 8 | 171.24 | 17.40 | 77.87 | 77.87 |
| `t-env` | 4 | 30.36 | 3.18 | 8.14 | 8.14 |
| `t-rnaseq2` | 4 | 34.76 | 5.24 | 9.98 | 9.98 |
| `t-strict` | 4 | 27.98 | 5.33 | 6.18 | 6.18 |

Placement latency = `start − submit` from the trace, the interval between
Nextflow submitting a task and the orchestrator starting it. This is the X4
measurement, and it needs no separate compute run: it is already in every trace.

## Read this before quoting any of these numbers

Container image caching dominates the distribution. `t-demo` ran first, with
cold images, and its tail (77.9 s) is image pull, not scheduling. The later runs,
on warm images, sit at **p50 ≈ 3–5 s**. So:

- Placement latency reported as a property of *the executor* must come from runs
  with pre-pulled/warm images, with that stated explicitly.
- A cold-image number is still worth reporting, but as a *first-run* cost, and
  labelled as such.

These are also 4–8-task toy pipelines on a single node; they characterise the
submit→start path, not throughput or scaling. The manuscript's runtime and
latency claims come from the X1/X2 runs on real pipelines, not from these.
