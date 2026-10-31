# Template architecture

Diagrams of what each template actually provisions, drawn from the code in this repository
rather than from the manuscript text. Where the two disagree, the disagreement is noted.

The repository ships two templates. `local-docker/` is the reviewer path, a Docker Compose
cluster that needs nothing but Docker. `cloud-gcp/` shows the same plugin against preemptible
cloud capacity, which is what the resilience claim is measured on.

---

## `local-docker/`, the reviewer artefact ★

Start here. One machine, Docker only, no cloud account and no credentials. This is the
path a reviewer takes, and it is the only template verified end to end (2026-08-06).

```mermaid
graph TB
    Op(["Reviewer<br/>./scripts/start.sh"])

    subgraph Host["One machine — Docker only"]
        subgraph Core["default cluster · 4 containers"]
            S["<b>nomad-server</b><br/>schedules only<br/>client { enabled = false }<br/>:4646 HTTP · :4647 RPC"]
            C1["nomad-client-1<br/><i>worker</i>"]
            C2["nomad-client-2<br/><i>worker</i>"]
            C3["nomad-client-3<br/><i>worker · CLIENTS=N to scale</i>"]
        end
        SV[("shared volume<br/><i>NFS stand-in —<br/>mode 1, shared POSIX FS</i>")]
        M["<b>minio</b><br/>S3 endpoint<br/><i>profile: storage</i><br/>WITH_STORAGE=1<br/><i>mode 3, nf-nomad-s5cmd</i>"]
    end

    Op --> S
    C1 -->|register| S
    C2 -->|register| S
    C3 -->|register| S
    C1 -.-> SV
    C2 -.-> SV
    C3 -.-> SV
    M -.->|"mode 3 only —<br/>mode 2 (Fusion) needs<br/>no local service"| C1

    Chaos(["./scripts/chaos.sh"])
    Chaos ==>|"docker stop<br/>a busy client"| C2
    C2 ==>|"allocations<br/>displaced"| S
    S ==>|"reschedule onto<br/>surviving nodes"| C1
    S ==> C3

    style S fill:#e1f5ff,stroke:#0066cc,stroke-width:2px
    style C2 fill:#fdecea,stroke:#c62828,stroke-width:2px
    style M fill:#f3f3f1,stroke:#9e9e9e,stroke-dasharray: 4 3
    style SV fill:#e8f5e9,stroke:#2e7d32
    style Chaos fill:#fdecea,stroke:#c62828
```

Figure. The local cluster and a reallocation trial. The server schedules but runs nothing
(`client { enabled = false }`), so stopping a client exercises rescheduling rather than
decapitating the cluster. Clients are replicas of one image, scaled with `CLIENTS=N`; each
registers to the server and mounts a shared Docker volume that stands in for NFS, which is what
makes the shared-POSIX work-dir mode demonstrable locally. Mode numbering follows Figure 1 of
the manuscript: 1 = shared POSIX FS, 2 = Fusion + Wave, 3 = `nf-nomad-s5cmd`. MinIO is opt-in
(`profile: storage`) because it serves mode 3 only, and because the reallocation test is pure
scheduling, nothing stages data, so the default cluster is four containers. The heavy arrows trace one `chaos.sh` trial: stop a busy
client, its allocations are displaced, the scheduler places them on the survivors, and recovery
is timed from the stop to the job regaining its desired count.

| Verified 2026-08-06 | |
|---|---|
| Cluster | 1 server + 3 clients ready, no object store |
| Placement | 6-allocation job spread 3 / 2 / 1 |
| Recovery | 4 trials, **median 26 s** (24, 26, 26, 27) |

Compared with upstream's `docker/`, which runs a **single agent that is both server and
client** and therefore cannot reschedule anything at all, the only structural change here is
splitting those roles. Nomad version, ACL flow and `s5cmd` path are kept identical so the two
do not drift.

---

## `cloud-gcp/gcp-infra/`, GCP tier with an overlay-joined spot pool

Provisions its own VPC, a Nomad server and clients, and a preemptible spot pool. Nodes join a
Tailscale mesh, which is what allows this tier to share one Nomad cluster with nodes elsewhere.

```mermaid
graph TB
    subgraph VPC["GCP VPC — nomad-cluster-&lt;stack&gt;"]
        subgraph Sub["Private subnet"]
            GS["Nomad server"]
            GC["Nomad clients<br/><i>clientCount</i>"]
            SP["Spot pool<br/><b>PREEMPTIBLE</b><br/>node_pool=compute"]
        end
        RT{{"Cloud Router<br/>+ NAT"}}
    end
    TS(["Tailscale mesh<br/>100.64.0.0/10"])
    GS <--> TS
    GC <--> TS
    SP <--> TS
    GC -->|register| GS
    SP -->|register| GS
    Sub --> RT
    SVC["Nomad service jobs"]
    MIN["MinIO<br/>S3 endpoint<br/><i>s5cmd mode</i>"]
    NFS["NFS plugin +<br/>shared volume<br/><i>shared-POSIX mode</i>"]
    NFH["Nextflow head job"]
    GS --> SVC
    SVC --> MIN
    SVC --> NFS
    SVC --> NFH
    style Sub fill:#fff4e1,stroke:#cc8800
    style SP fill:#fdecea,stroke:#c62828
    style MIN fill:#e1f5ff,stroke:#0066cc
    style NFS fill:#e8f5e9,stroke:#2e7d32
```

The spot pool is where GCP reclaims capacity on its own schedule, and the executor must
reschedule the affected tasks. The E3 reported in the manuscript was measured differently, by
stopping single task allocations on the institutional cluster; see
`../validation/results/E3-preemption-recovery/`. MinIO and the NFS volume are the two work-directory
backends; Fusion needs neither, only network reach to an object store.

---

## `cloud-gcp/spot-compute/`, elastic capacity for an existing cluster

Standalone, and distinct from `gcp-infra`: it adds spot capacity to a cluster that already
exists rather than creating one. Isolated Pulumi state, no shared resources.

```mermaid
graph LR
    subgraph Existing["Existing Nomad cluster (elsewhere)"]
        AI["Nomad server<br/><i>on-premises</i>"]
    end
    subgraph GCPS["GCP — nomad-cluster-spot-&lt;stack&gt;"]
        AS["Autoscaler VM<br/>e2-small, always on<br/>nomad-autoscaler"]
        MIG["Managed Instance Group<br/><b>SPOT</b> instances<br/>node_pool=compute<br/>host_volume nf-work"]
        SA["Service account<br/>+ IAM instanceAdmin"]
    end
    TS(["Tailscale mesh"])
    AS -->|"APM: read metrics :4646"| TS
    TS --> AI
    MIG -->|"client RPC :4647"| TS
    AS -->|"scale target<br/>(gce-mig plugin)"| MIG
    SA -.->|grants| AS
    style MIG fill:#fdecea,stroke:#c62828
    style AS fill:#e1f5ff,stroke:#0066cc
```

The autoscaler reads Nomad's APM over the overlay and resizes the MIG. The instances are SPOT,
so preemption is expected behaviour rather than a fault, which is what makes this the right
substrate for the resilience claim.

---

## Which template serves which experiment

| Experiment | Template | Status |
|---|---|---|
| **X0** provision + profile | **`templates/local-docker`** (Docker Compose) | ready |
| **E1** substrate neutrality | `sun-aither` (existing cluster) | ready |
| **E2** mode equivalence | `gcp-infra` (MinIO + Fusion) | ready |
| **E3** preemption | any running cluster, with `validation/scripts/preemption_trial.py`; measured on the institutional cluster | ready |

The local path is the one a reviewer without cloud credentials reaches for first, and it is now
the verified one (2026-08-06). The cloud templates are reviewable as code but their at-scale
results are still to be generated; see the experiment handover for what each must produce.
