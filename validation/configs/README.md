# Validation configs, nf-nomad manuscript

Generic, env-driven Nextflow configs for the validation campaign (handover
`brainstorms/nf-nomad/2026-08-05-experiment-handover.md`). Every site-specific
value comes from the environment (`campaign.env.example`) or `nextflow secrets`,
so these files are publishable as-is, no cluster identity, endpoints, or tokens.

## The matrix

| Config | Experiment | Substrate | Work dir | Nodes |
|---|---|---|---|---|
| `e1-armA-local.config` | **E1** (substrate neutrality) | Nextflow **local** (no Nomad) | native FS | 1 |
| `e1-armB-nomad-posix.config` | **E1** | Nextflow + **nf-nomad** | **shared-POSIX host volume** | 1 (pinned) |
| `e2-fusion.config` | **E2** (mode equivalence) | nf-nomad + **Fusion + Wave** | **S3** | multi |
| `e2-s5cmd.config` | **E2** | nf-nomad + **s5cmd** | **S3** | multi |
| `../chaos/` | **E3** (preemption) | nf-nomad + chaos harness | — | multi |
| `nextflow.trace.config` | all | — | — | — |

- **E1** varies only the executor, local vs Nomad, on one node with a shared POSIX
  work dir. Both arms run `mtbseq-nf` on the same node.
- **E2** varies only the work-dir mode, Fusion vs s5cmd, across nodes with S3 as the
  shared layer. Run both pipelines through both modes and compare outputs.

## Pipelines & data

| Pipeline | Where | Data |
|---|---|---|
| `mtbseq-nf` | published, Microorganisms 2025 13(12):2685 | ENA `PRJEB7727` — 5 samples (timed loop), then 90 (digest claim) |
| `nf-core/taxprofiler` | nf-core | `-profile test_full` |

## Running the campaign on stock Nomad

`nextflow-head.nomad.hcl` runs the Nextflow driver as a Nomad batch job, and nf-nomad
submits each process as its own Nomad job. It takes plain `nomad job run` on any Nomad
cluster:

```bash
# 1. put the secrets Variable on your cluster (see nextflow-head.vars.example)
nomad var put nomad/jobs/nextflow-head nomad_token=<tok> s3_access_key=<k> s3_secret_key=<s>

# 2. launch (from this configs/ dir — the *.config files embed at submit time)
nomad job run \
  -var 'pipeline=mtbseq-nf' \
  -var 'config_file=e1-armB-nomad-posix.config' \
  -var 'target_node=<node>' \
  -var 'nextflow_args=-profile docker --input <sheet> -w /work/work-armB' \
  nextflow-head.nomad.hcl
```

Arm A uses the local executor, so it is a plain `nextflow run` with no head job.
`config_file` is one of the four in the matrix.

## Run recipe (direct, from a submit host with cluster + FS access)

```bash
cp campaign.env.example campaign.env      # fill site values (untracked)
source campaign.env
nextflow secrets set NF_VALIDATION_S3_ACCESS_KEY <key>     # E2 only
nextflow secrets set NF_VALIDATION_S3_SECRET_KEY <secret>  # E2 only

# E1 — both arms on the SAME node ($NOMAD_TARGET_NODE), same data:
RUN_TAG=e1-armA nextflow run mtbseq-nf -c e1-armA-local.config       -w ./work-armA        -profile <container> --input <5-sample-sheet>
RUN_TAG=e1-armB nextflow run mtbseq-nf -c e1-armB-nomad-posix.config -w <volmount>/work-armB -profile <container> --input <5-sample-sheet>

# E2 — both pipelines × both modes (work dir is s3://):
RUN_TAG=e2-fusion-mtbseq   nextflow run mtbseq-nf         -c e2-fusion.config -w s3://<bucket>/work-e2-fusion-mtbseq   -profile <container> ...
RUN_TAG=e2-s5cmd-mtbseq    nextflow run mtbseq-nf         -c e2-s5cmd.config  -w s3://<bucket>/work-e2-s5cmd-mtbseq    -profile <container> ...
RUN_TAG=e2-fusion-taxprof  nextflow run nf-core/taxprofiler -c e2-fusion.config -w s3://<bucket>/work-e2-fusion-taxprof -profile test_full,<container> ...
RUN_TAG=e2-s5cmd-taxprof   nextflow run nf-core/taxprofiler -c e2-s5cmd.config  -w s3://<bucket>/work-e2-s5cmd-taxprof  -profile test_full,<container> ...
```

## Verified working, and four traps on the way there

The matrix was checked end to end on 2026-08-06 with nf-nomad 0.5.0-edge3 and
Nextflow 26.04.3, running two reference pipelines through the Nomad executor to
completion:

| Pipeline | Result | Tasks |
|---|---|---|
| `nextflow-io/rnaseq-nf` | exit 0, **54 s** | 4/4 `COMPLETED` |
| `nf-core/demo` (`-r dev -profile test,docker`) | exit 0, **205 s** | 8/8 `COMPLETED` |

Four fixes were needed first. Each one fails in a way that points somewhere other
than the cause:

1. **Use the strict-parser config syntax, not the old closure DSL.** Nextflow
   26.x's strict config parser rejects the Groovy closure DSL outright
   (``Error: `type` is not defined`` / ``` `attr` is not defined ```). nf-nomad
   adopted the compatible syntax upstream in
   [PR #132](https://github.com/nextflow-io/nf-nomad/pull/132) (merged 2026-06-07):

   | Old (closure DSL, fails on NXF 26.x) | Current (strict-parser) |
   |---|---|
   | `volume = { type "host" name "x" path "/w" }` | `volumes = [[type: "host", name: "x", path: "/w"]]` |
   | `constraints = { attr { node { … } } }` | `constraints { node { … } }` |

   With this syntax no `NXF_SYNTAX_PARSER` override is needed, verified here.
   (The deprecated `NXF_SYNTAX_PARSER=v1` fallback makes the *old* DSL parse, but
   don't ship that: it pins you to a parser Nextflow is retiring.)
2. `System.getenv()` is fine under the strict parser, verified, so configs
   can stay generic and site values can come from the environment.
3. `privileged = false`. nf-nomad requests privileged Docker containers by
   default; most hardened Nomad agents refuse, and every task dies with
   `Docker privileged mode is disabled on this Nomad agent`, reported by Nextflow
   as a task failure (`status=FAILED`, `exit=0`) rather than a configuration error.
4. Set the node pool explicitly (`nodePool` in the config, `node_pool` in the
   job HCL). If the pool has no nodes, the scheduler evaluates zero nodes and the
   job sits `pending` indefinitely. The evaluation carries no constraint text to
   explain it.

   Leave `failOnPlacementFailure` at its default of `false` on 0.5.0-edge3. Setting
   it `true` fails tasks that are queued normally behind a busy node, because the
   check keys on a wall-clock timeout that defaults to 60 s and cannot tell queueing
   from a genuine placement failure. That distinction is fixed on the
   `fix/placement-failure-vs-queueing` branch; until it releases, `true` costs runs.

Point `NOMAD_ADDR` at the address the Nomad agent binds, typically a private or VPN
address such as a Tailscale IP, rather than a public edge URL. That keeps proxies out
of the path.

## Non-negotiables (handover §4)

- **Traces from run 1**, `nextflow.trace.config` is included everywhere; a run
  without traces must be repeated. X4 latency = `start − submit` from these.
- **Pin one plugin version** for the whole campaign (`0.5.0-edge3`); record it +
  `NXF_VER` in every trace/environment profile. `nf-nomad ≥ 0.4.4` needs `NXF ≥ 26.04.3`.
- **Same hardware across E1 arms**, both on `$NOMAD_TARGET_NODE`, or the
  comparison is void.
- **Driver:** `exec`/`exec2` hang on some kernels (Landlock); use `raw_exec` or
  docker and record which in S1.
- **From-scratch cost:** `--resume` does not cache across launches. Budget full
  wall-clock per arm and get the config right before launching.

## Capture per run → supplementary

`-with-trace/-with-report/-with-timeline` (via this config), total walltime, and
**SHA-256 of every output file**. Digest manifests → `S3` (E1) and `S4` (E2); walltime
and placement percentiles → `S3.2`; preemption deltas (E3) → `S5`.
