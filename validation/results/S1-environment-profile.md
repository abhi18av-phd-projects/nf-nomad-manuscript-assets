# S1 — Environment profile (X0)

Hardware, software and network profile of the environment used for the nf-nomad
validation campaign. Generated 2026-08-06. Cluster identity is deliberately
generic (see `../../SANITISE.md`); node roles and sizes are what matter for
reproducibility.

## Orchestration substrate

| Property | Value |
|---|---|
| Orchestrator | HashiCorp Nomad (ACL enabled) |
| Nodes | 8 (1 platform, 5 compute, 1 data, 1 transient) |
| Network layer | Tailscale mesh VPN; the Nomad agent binds its tailnet address |
| Task drivers available | `docker`, `containerd`, `podman`, `singularity`, `exec`, `exec2`, `java`, `raw_exec`, `qemu` |
| Driver used for tasks | **`docker`** (non-privileged) |

## Execution node (X1 both arms, X0 smoke tests)

| Property | Value |
|---|---|
| Role | platform-pool node |
| CPU | 48 cores — Intel Xeon E5-2690 v3 @ 2.60 GHz (reported 3.5 GHz max) |
| Memory | 251 GiB (257,824 MB) |
| Work-dir volume | registered Nomad `host_volume`, 400 GB filesystem, 376 GB free |
| Work-dir mount | same path (`/work`) in the head job and every task job |
| Reserved cores at test time | 2 of 48 (unrelated tenant) |

Compute-pool nodes (used for multi-node X2/X3) are materially smaller:
8 cores/7.9 GB, 24 cores/24 GB, 16 cores/20 GB — the resource ceiling in the
configs is sized to fit them.

## Software versions (pinned for the whole campaign)

| Component | Version |
|---|---|
| Nextflow | **26.04.3** (build 12259) |
| nf-nomad plugin | **0.5.0-edge3** (public: `registry.nextflow.io`) |
| Config parser | **strict (default)** — no `NXF_SYNTAX_PARSER` override; configs use the syntax from nf-nomad PR #132 |
| Head-job image | `nextflow/nextflow:26.04.3` |

`nf-nomad ≥ 0.4.4` requires `NXF ≥ 26.04.3`. Since upstream PR #132 the plugin's
config syntax parses under Nextflow's default strict parser, so no legacy-parser
fallback is used.

## Network / egress (verified from inside a task container)

| Check | Result |
|---|---|
| Nextflow plugin registry (`registry.nextflow.io`) | reachable (200) |
| GitHub (pipeline pull) | reachable (200) |
| Nomad API from inside the task | reachable (200) |
| Container images | pulled from Docker Hub / quay.io at run time |

## Cold start

Provisioning wall-clock is **not** reported here: the environment was a
pre-existing, continuously-running cluster (113 days uptime at test time), so no
cold-start provisioning was performed in this campaign. Any cold-start figure in
the manuscript must come from an actual timed provisioning run using the
templates in `../../templates/`, or be dropped.

## X0 verification runs

Both reference pipelines completed through the Nomad executor with full trace
capture:

| Pipeline | Exit | Wall-clock | Tasks |
|---|---|---|---|
| `nextflow-io/rnaseq-nf` | 0 | 54 s | 4/4 `COMPLETED` |
| `nf-core/demo` (`-r dev -profile test,docker`) | 0 | 205 s | 8/8 `COMPLETED` |

Per-task `submit`/`start`/`complete` timestamps were captured, which is the input
X4 needs for placement-latency percentiles (`start − submit`). Observed
placement latency in these smoke runs ranged from ~3 s to ~77 s, the longer tail
corresponding to first-time container image pulls — image locality must therefore
be controlled (pre-pulled or warm) before latency percentiles are reported as a
property of the executor rather than of the image cache.
