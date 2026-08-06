# Local Nomad cluster — the reviewer artefact

One command brings up a multi-node Nomad cluster with an S3 endpoint, on any machine with
Docker. No cloud account, no VM layer, no credentials.

```bash
./scripts/start.sh          # server + 3 clients + MinIO
./scripts/run-pipeline.sh   # a pipeline through nf-nomad
./scripts/chaos.sh          # kill a client mid-run (preemption trial)
./scripts/stop.sh
```

## Why Docker rather than Multipass

The nf-nomad project already tests against a **containerised Nomad** in its own CI
(`docker/` upstream), and that approach is strictly better for a reviewer than the
Multipass/Pulumi route: no hypervisor, no VM images, no provider plugin, and it works
identically on macOS, Linux and Windows. This directory is a **minimal, multi-node
derivative** of that upstream setup.

## What it adds over upstream

Upstream's compose file runs a **single agent that is both server and client**
(`bootstrap_expect = 1`, `name = "client_dev"`). That is sufficient for functional tests but
**cannot demonstrate rescheduling**, because there is no second node to reschedule onto.

This variant separates the roles:

| | upstream `docker/` | here |
|---|---|---|
| Topology | 1 agent, server + client | 1 server + **N client containers** |
| Scaling | fixed | `CLIENTS=5 ./scripts/start.sh` |
| Node loss | not possible | `./scripts/chaos.sh` stops a client |
| Purpose | functional / CI | **X3 preemption trials**, plus X0 and X2 |

Everything else is kept deliberately close to upstream so the two do not drift: same Nomad
version, same ACL bootstrap, same MinIO service, same `s5cmd` binary location.

## What each experiment gets

| | |
|---|---|
| **X0** provision + first pipeline | time `start.sh` → first completed pipeline |
| **X2** mode equivalence | MinIO is present, so the s5cmd and Fusion modes both run here |
| **X3** preemption | `chaos.sh` stops a client mid-run; measure reschedule latency |

X1 (substrate neutrality) needs real hardware and stays on the institutional cluster.

## What this is not

A production deployment. Single server, no Raft quorum, ACLs bootstrapped to a throwaway
token, MinIO with default credentials on a private Docker network. It is an evaluation
environment, and the cloud templates under `templates/` document the at-scale topology.
