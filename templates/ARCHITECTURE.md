# Template architecture

Diagrams of what each template actually provisions, drawn from the code in this repository
rather than from the manuscript text. Where the two disagree, the disagreement is noted.

---

## ⚠ `local-multipass/` — does not yet provision a cluster

**Read this before reviewing the local template.** The manuscript (§3.1, Supplementary S1)
describes *"a Pulumi + Multipass project [that] provisions a 1-server + N-client Nomad cluster
on a single laptop (≥16 GB RAM) in under 30 minutes"*. **No such project exists in the source
tree.** What is here is two unrelated pieces:

```mermaid
graph TB
    subgraph Claimed["MANUSCRIPT §3.1 — claimed"]
        C1["Pulumi + Multipass project"]
        C2["1 Nomad server VM"]
        C3["N Nomad client VMs"]
        C4["≤30 min provision<br/>≤60 min to first pipeline"]
        C1 --> C2
        C1 --> C3
        C2 --> C4
    end
    subgraph Actual["THIS REPOSITORY — actual"]
        A1["setup.sh<br/><i>copier template, unrendered</i><br/>{{ project_name }} placeholders"]
        A2["ONE generic Ubuntu 22.04 VM<br/>data-science cloud-init<br/><i>no Nomad</i>"]
        A3["start_nomad.sh<br/><i>personal scratch script</i><br/>runs nomad agent -dev ON THE HOST"]
        A4["local_nomadlab.hcl<br/>⚠ hard-coded path<br/>⚠ allow_privileged = true"]
        A1 --> A2
        A3 --> A4
    end
    Claimed -.->|"gap"| Actual
    style Claimed fill:#e8f5e9,stroke:#2e7d32
    style Actual fill:#fdecea,stroke:#c62828
    style A4 fill:#fff4e1,stroke:#cc8800
```

Three specific defects:

1. **`setup.sh` is an unrendered copier template.** It still carries `{{ project_name }}`,
   `{{ multipass_memory }}` and similar placeholders, and it launches **one** general-purpose
   VM. It does not install or configure Nomad.
2. **`start_nomad.sh` runs on the host, not in VMs.** It calls `nomad agent -dev` under
   `/usr/local/bin/bash` with commented-out `nextflow run` lines. It is a developer scratch
   file, not a provisioning script.
3. **`local_nomadlab.hcl` will not work for anyone else.** It hard-codes an absolute path from
   the author's machine as a `host_volume`, and it sets `allow_privileged = true` plus
   `"docker.priviledged.enabled" = "true"` (note the typo, which means that second key does
   nothing). **The privileged default contradicts §2.1**, which states that Docker task-driver
   configuration defaults to non-privileged.

Since §3.1 calls this template *"the canonical reviewer artefact"*, closing this gap is a
submission blocker, not a polish item. It is X0 in the experiment handover.

---

## `cloud-oci-gcp/oracle-infra/` — OCI persistent tier

Real and complete. Provisions an isolated VCN with a public bastion and a private Nomad tier;
workers have no public addresses and egress through a NAT gateway.

```mermaid
graph TB
    subgraph VCN["OCI VCN — nomad-cluster-&lt;stack&gt;"]
        subgraph Pub["Public subnet"]
            B["Bastion<br/>public IP · SSH jump"]
            IGW{{"Internet Gateway"}}
        end
        subgraph Priv["Private subnet — no public IPs"]
            NS["Nomad server<br/>:4646 HTTP · :4647 RPC"]
            NC1["Nomad client 0"]
            NC2["Nomad client 1<br/><i>…N, via nomadClientCount</i>"]
        end
        NAT{{"NAT Gateway<br/>egress only"}}
        SGW{{"Service Gateway<br/>OCI services"}}
    end
    Op(["Operator"]) -->|SSH| B
    B -->|provision over SSH| NS
    B -->|provision over SSH| NC1
    B -->|provision over SSH| NC2
    NC1 -->|register| NS
    NC2 -->|register| NS
    Priv --> NAT --> IGW
    Priv --> SGW
    style Pub fill:#e1f5ff,stroke:#0066cc
    style Priv fill:#fff4e1,stroke:#cc8800
```

Security lists restrict the private subnet to `10.0.1.0/24` on SSH, 4646 and 8080. Client count
is `nomadClientCount` (default 2).

---

## `cloud-oci-gcp/gcp-infra/` — GCP tier with an overlay-joined spot pool

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

The spot pool is where **X3 preemption trials** run: instances are reclaimed by GCP, and the
executor must reschedule the affected tasks. MinIO and the NFS volume are the two work-directory
backends; Fusion needs neither, only network reach to an object store.

---

## `cloud-oci-gcp/spot-compute/` — elastic capacity for an existing cluster

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
so preemption is expected behaviour rather than a fault — which is what makes this the right
substrate for the resilience claim.

---

## Which template serves which experiment

| Experiment | Template | Status |
|---|---|---|
| **X0** provision + profile | `local-multipass` | ⚠ **blocked** — template does not provision a cluster |
| **X1** substrate neutrality | `sun-aither` (existing cluster) | ready |
| **X2** mode equivalence | `gcp-infra` (MinIO + Fusion) | ready |
| **X3** preemption, 10 trials | `gcp-infra` spot pool, or `spot-compute` | ready |

The cloud path is reviewable now. The local path — the one a reviewer without cloud credentials
would reach for first — is the gap.
