# Validation configs — nf-nomad manuscript

Generic, env-driven Nextflow configs for the validation campaign (handover
`brainstorms/nf-nomad/2026-08-05-experiment-handover.md`). Every site-specific
value comes from the environment (`campaign.env.example`) or `nextflow secrets`,
so these files are publishable as-is — no cluster identity, endpoints, or tokens.

## The matrix

| Config | Experiment | Substrate | Work dir | Nodes |
|---|---|---|---|---|
| `x1-armA-local.config` | **X1** (substrate neutrality) | Nextflow **local** (no Nomad) | native FS | 1 |
| `x1-armB-nomad-posix.config` | **X1** | Nextflow + **nf-nomad** | **shared-POSIX host volume** | 1 (pinned) |
| `x2-fusion.config` | **X2** (mode equivalence) | nf-nomad + **Fusion + Wave** | **S3** | multi |
| `x2-s5cmd.config` | **X2** | nf-nomad + **s5cmd** | **S3** | multi |
| `../chaos/` | **X3** (preemption) | nf-nomad + chaos harness | — | multi |
| `nextflow.trace.config` | all | — | — | — |

- **X1** isolates the *only* variable that matters for substrate neutrality —
  local vs Nomad — on **one node** with identical hardware and a shared POSIX
  work dir. Both arms run the **same pipeline** (`mtbseq-nf`) on the same node.
- **X2** isolates the *work-dir mode* — Fusion vs s5cmd — across nodes (S3 is the
  shared layer). Run **both pipelines** (`mtbseq-nf` **and** `nf-core/taxprofiler`)
  through **both** modes and compare outputs.

## Pipelines & data

| Pipeline | Where | Data |
|---|---|---|
| `mtbseq-nf` | published, Microorganisms 2025 13(12):2685 | ENA `PRJEB7727` — 5 samples (timed loop), then 90 (digest claim) |
| `nf-core/taxprofiler` | nf-core | `-profile test_full` |

## Reproducing without any vendor CLI — the Nomad head job

A reviewer has **no project-specific CLI**, so the campaign must be launchable with stock
HashiCorp Nomad. `nextflow-head.nomad.hcl` runs the Nextflow driver *as a Nomad
batch job*; nf-nomad then submits each process as its own Nomad job. Launch it
with plain `nomad job run` on any Nomad cluster — no vendor tooling:

```bash
# 1. put the secrets Variable on your cluster (see nextflow-head.vars.example)
nomad var put nomad/jobs/nextflow-head nomad_token=<tok> s3_access_key=<k> s3_secret_key=<s>

# 2. launch (from this configs/ dir — the *.config files embed at submit time)
nomad job run \
  -var 'pipeline=mtbseq-nf' \
  -var 'config_file=x1-armB-nomad-posix.config' \
  -var 'target_node=<node>' \
  -var 'nextflow_args=-profile docker --input <sheet> -w /work/work-armB' \
  nextflow-head.nomad.hcl
```

Arm A (local executor) is a plain `nextflow run` and needs no head job. Every
`config_file` above is one of the four in the matrix.

## Run recipe (direct, from a submit host with cluster + FS access)

```bash
cp campaign.env.example campaign.env      # fill site values (untracked)
source campaign.env
nextflow secrets set NF_VALIDATION_S3_ACCESS_KEY <key>     # X2 only
nextflow secrets set NF_VALIDATION_S3_SECRET_KEY <secret>  # X2 only

# X1 — both arms on the SAME node ($NOMAD_TARGET_NODE), same data:
RUN_TAG=x1-armA nextflow run mtbseq-nf -c x1-armA-local.config       -w ./work-armA        -profile <container> --input <5-sample-sheet>
RUN_TAG=x1-armB nextflow run mtbseq-nf -c x1-armB-nomad-posix.config -w <volmount>/work-armB -profile <container> --input <5-sample-sheet>

# X2 — both pipelines × both modes (work dir is s3://):
RUN_TAG=x2-fusion-mtbseq   nextflow run mtbseq-nf         -c x2-fusion.config -w s3://<bucket>/work-x2-fusion-mtbseq   -profile <container> ...
RUN_TAG=x2-s5cmd-mtbseq    nextflow run mtbseq-nf         -c x2-s5cmd.config  -w s3://<bucket>/work-x2-s5cmd-mtbseq    -profile <container> ...
RUN_TAG=x2-fusion-taxprof  nextflow run nf-core/taxprofiler -c x2-fusion.config -w s3://<bucket>/work-x2-fusion-taxprof -profile test_full,<container> ...
RUN_TAG=x2-s5cmd-taxprof   nextflow run nf-core/taxprofiler -c x2-s5cmd.config  -w s3://<bucket>/work-x2-s5cmd-taxprof  -profile test_full,<container> ...
```

## Verified working — and the four traps that stop it working

The whole matrix was smoke-tested end to end on **2026-08-06** with
**nf-nomad 0.5.0-edge3 / Nextflow 26.04.3**, running two reference pipelines
through the Nomad executor to completion:

| Pipeline | Result | Tasks |
|---|---|---|
| `nextflow-io/rnaseq-nf` | exit 0, **54 s** | 4/4 `COMPLETED` |
| `nf-core/demo` (`-r dev -profile test,docker`) | exit 0, **205 s** | 8/8 `COMPLETED` |

Getting there required four fixes. Each produces a confusing failure, so they are
worth knowing before you burn a long run:

1. **Use the strict-parser config syntax — not the old closure DSL.** Nextflow
   26.x's strict config parser rejects the Groovy closure DSL outright
   (``Error: `type` is not defined`` / ``` `attr` is not defined ```). nf-nomad
   adopted the compatible syntax upstream in
   [PR #132](https://github.com/nextflow-io/nf-nomad/pull/132) (merged 2026-06-07):

   | Old (closure DSL — fails on NXF 26.x) | Current (strict-parser) |
   |---|---|
   | `volume = { type "host" name "x" path "/w" }` | `volumes = [[type: "host", name: "x", path: "/w"]]` |
   | `constraints = { attr { node { … } } }` | `constraints { node { … } }` |

   With this syntax **no `NXF_SYNTAX_PARSER` override is needed** — verified here.
   (The deprecated `NXF_SYNTAX_PARSER=v1` fallback makes the *old* DSL parse, but
   don't ship that: it pins you to a parser Nextflow is retiring.)
2. **`System.getenv()` is fine** under the strict parser — verified — so configs
   can stay generic and site values can come from the environment.
3. **`privileged = false`.** nf-nomad requests privileged Docker containers by
   default; most hardened Nomad agents refuse, and every task dies with
   `Docker privileged mode is disabled on this Nomad agent` — reported by Nextflow
   as a *task* failure (`status=FAILED`, `exit=0`), which misdirects debugging.
4. **Set the node pool explicitly** (`nodePool` in the config, `node_pool` in the
   job HCL). If the pool has no nodes, the scheduler evaluates **zero** nodes and
   the job sits `pending` forever **with no error message** — the eval carries no
   constraint text to explain it. `failOnPlacementFailure = true` converts other
   placement failures into fast errors rather than hangs.

**Endpoint choice:** point `NOMAD_ADDR` at the address the Nomad agent actually
binds (typically a private/VPN address such as a Tailscale IP), not a public edge
URL — fewer hops and no proxy in the path.

## Non-negotiables (handover §4)

- **Traces from run 1** — `nextflow.trace.config` is included everywhere; a run
  without traces must be repeated. X4 latency = `start − submit` from these.
- **Pin one plugin version** for the whole campaign (`0.5.0-edge3`); record it +
  `NXF_VER` in every trace/environment profile. `nf-nomad ≥ 0.4.4` needs `NXF ≥ 26.04.3`.
- **Same hardware across X1 arms** — both on `$NOMAD_TARGET_NODE`, or the
  comparison is void.
- **Driver:** `exec`/`exec2` hang on some kernels (Landlock); use `raw_exec` or
  docker and record which in S1.
- **From-scratch cost:** `--resume` does not cache across launches — budget full
  wall-clock per arm and get the config right before launching.

## Capture per run → supplementary

`-with-trace/-with-report/-with-timeline` (via this config), total walltime, and
**SHA-256 of every output file**. Digest manifests → `S3`/`S6`; walltime + p50/p95/p99
(derived from traces, X4) → `S4`; preemption deltas (X3) → `S4`.
