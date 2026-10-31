# nf-nomad manuscript assets

Deployment templates, validation configurations, measured results and a reviewer protocol for
nf-nomad, the Nextflow executor plugin for HashiCorp Nomad. It is the companion artefact to the
nf-nomad manuscript, and it lets the numbers reported there be re-measured.

## Start here

Three documents, in order, from a bare machine to the measurements the manuscript reports.

| | | |
|---|---|---|
| 1 | [Provision](protocol/01-provision.md) | bring up a cluster, either in containers on one machine or as a preemptible cloud fleet |
| 2 | [Run](protocol/02-run-pipeline.md) | run each experiment and collect its measurements |
| 3 | [Verify](protocol/03-expected-output.md) | what a correct run produces, with the reference numbers to compare against |

The local template is the intended starting point. It needs no cloud account, and it is also the
CI environment for the plugin itself.

## The three experiments

Each experiment holds everything constant except one variable, then compares the arms. These are
the results to reproduce; the datasets behind them are in `validation/results/`.

```mermaid
flowchart TB
  classDef held fill:#F1E6D3,stroke:#6B5D4F,color:#2B241D
  classDef arm  fill:#FFFFFF,stroke:#3A2E22,color:#2B241D
  classDef res  fill:#DCE7E1,stroke:#3E6259,color:#2B241D

  subgraph E1["E1 &nbsp;·&nbsp; does the executor change the result?"]
    direction TB
    H1["held constant<br/><i>MTBseq-nf · 90 sequences · containers · hardware</i>"]:::held
    H1 --> A1["Nextflow local executor<br/><i>no Nomad in the path</i>"]:::arm
    H1 --> A2["nf-nomad"]:::arm
    A1 --> R1["636 / 636 tasks, both arms, no failures<br/><b>281 of 283 result tables agree</b><br/>0 differences in genomic position"]:::res
    A2 --> R1
  end

  subgraph E2["E2 &nbsp;·&nbsp; do the data paths agree?"]
    direction TB
    H2["held constant<br/><i>nf-core/detaxizer · inputs · cluster</i>"]:::held
    H2 --> B1["Fusion + Wave<br/><i>S3 work directory</i>"]:::arm
    H2 --> B2["nf-nomad-s5cmd<br/><i>S3 work directory</i>"]:::arm
    B1 --> R2["54 / 54 tasks, both arms, no failures<br/><b>every sequence output bit-identical</b>"]:::res
    B2 --> R2
  end

  subgraph E3["E3 &nbsp;·&nbsp; is a preempted task recovered?"]
    direction TB
    H3["held constant<br/><i>pipeline · node</i>"]:::held
    H3 --> C1["running task allocation stopped<br/>mid-run, 9 preemptions in 2 runs"]:::arm
    C1 --> R3["<b>9 of 9 allocations rescheduled</b>, no intervention, no timeouts<br/><i>pipeline survival is a second layer: with errorStrategy=retry the run completed</i>"]:::res
  end
```

| | Reproduce with | Measured data |
|---|---|---|
| E1 | `e1-armA-local.config`, `e1-armB-nomad-posix.config` | [`E1-executor-neutrality/`](validation/results/E1-executor-neutrality/) |
| E2 | `e2-fusion.config`, `e2-s5cmd.config` | [`E2-storage-plane-equivalence/`](validation/results/E2-storage-plane-equivalence/) |
| E3 | `validation/scripts/preemption_trial.py` | [`E3-preemption-recovery/`](validation/results/E3-preemption-recovery/) |

## What is here

| Path | Contents |
|---|---|
| `templates/local-docker/` | One Nomad server and N clients as containers on a single machine. Docker is the only prerequisite. |
| `templates/cloud-gcp/` | A GCP preemptible spot fleet joined over an overlay network, for exercising recovery on capacity GCP reclaims itself. The reported E3 was not measured here; see `validation/results/E3-preemption-recovery/`. |
| `templates/ARCHITECTURE.md` | Diagrams of what each template provisions. |
| `validation/configs/` | One Nextflow config per work-directory mode: shared POSIX, Fusion, nf-nomad-s5cmd. |
| `validation/pipelines/` | A synthetic sleep workload for exercising recovery. The reported preemption trials used the E1 pipeline, not this. |
| `validation/results/` | The measured datasets behind the manuscript, one directory per experiment. |
| `validation/scripts/` | Digest comparison, trace metrics, preemption timing. |
| `protocol/` | The three documents above. |

## Scope

These templates provision evaluation environments. They are not a production deployment system,
and they omit the multi-tenant policy, admission-control and audit layers a shared institutional
cluster needs.

## Credentials

Templates take their secrets at deploy time, from the environment or from `pulumi config set
--secret`. Committed configuration files carry placeholders. Runtime tokens written by the local
cluster are gitignored.

The published tree is clean. Earlier commits in this repository's history contained credentials,
which have been removed and rotated, so nothing in the history is a working value.

If you find something that looks like a live credential, please open an issue rather than a pull
request.

## Citing and licence

Archived on Zenodo, released under Apache-2.0 to match nf-nomad itself. See
[`CITATION.cff`](CITATION.cff).

## Related

- nf-nomad — <https://github.com/nextflow-io/nf-nomad>
- nf-nomad-s5cmd, the S3 work-directory provider
- The upstream `validation/` directory in the nf-nomad repository holds the per-feature
  configuration suite (constraints, directives, secrets, spread, volumes), which this repository
  does not duplicate.
