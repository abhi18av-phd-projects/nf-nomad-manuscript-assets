# Templates

> **Looking for the reviewer path?** It is not here — it is
> [`../validation/local-cluster/`](../validation/local-cluster/), a Docker-only cluster that
> needs no cloud account. These templates document the at-scale topology used for validation.

**See [`ARCHITECTURE.md`](ARCHITECTURE.md)** for a diagram of what each template provisions,
and for a documented gap between the manuscript's §3.1 local-template claim and the code.

Two deployment templates, both sanitised for publication. Every site-specific value is a
placeholder in angle brackets — substitute before deploying.

## `local-multipass/` — ⚠ incomplete

**This does not currently provision a Nomad cluster.** `setup.sh` is an unrendered copier
template that launches one general-purpose VM; `start_nomad.sh` runs `nomad agent -dev` on the
host; `local_nomadlab.hcl` hard-codes an absolute path and enables privileged Docker. The
manuscript describes a Pulumi + Multipass 1-server + N-client cluster; that project **does exist**
(`pulumi-provider-multipass`) but lives in a separate private repository and was not migrated here.
A reviewer following the Zenodo DOI must not need private access, so migrating it is X0 in the
experiment plan. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

```
setup.sh                        provision the VMs
cloud-init/data-science.yml     VM image definition
nomad/local_nomadlab.hcl        Nomad agent configuration
nomad/start_nomad.sh            bring the cluster up
nextflow/nextflow.local.config  work-dir mode configs (local / oci / sun variants)
nextflow/main.nf                smoke-test pipeline
```

## `cloud-oci-gcp/` — heterogeneous, preemptible

Three Pulumi projects that compose into the cloud topology used for the preemption and
heterogeneous-pool claims.

| Project | Provisions |
|---|---|
| `oracle-infra/` | OCI persistent nodes — Nomad server, clients, bastion |
| `gcp-infra/` | GCP Nomad nodes and the shared-storage / MinIO services |
| `spot-compute/` | GCP preemptible spot pool and its autoscaler |

Each is a standard Pulumi TypeScript project: `npm install && pulumi up`. Dependencies are
declared in `package.json`; no `node_modules` or lockfile state ships here.

The cloud template provisions **only what the validation needs**: Nomad servers and clients, an
NFS-backed shared volume, a MinIO S3 endpoint, a preemptible spot pool, and the Nextflow head job.

## Placeholders you must set

| Placeholder | Where |
|---|---|
| `<YOUR_GCP_PROJECT_ID>` | `gcp-infra`, `spot-compute` Pulumi configs |
| `<YOUR_COMPARTMENT_OCID>`, `<YOUR_TENANCY_OCID>` | `oracle-infra/Pulumi.dev.yaml` |
| `<NOMAD_NODE_TAILNET_IP>` | overlay addresses in configs and cloud-init |
| `NOMAD_TOKEN` (environment variable) | read at runtime; never write a literal ACL token |
| `tskey-auth-EPHEMERAL` | set as a Pulumi secret, not in a committed file |

## What was removed and why

- **SSH keypairs** — templates must generate or accept a key at deploy time.
- **`node_modules/` and Pulumi state** (`MANIFEST-*`, `LOCK`, `*.ldb`) — ~1.6 GB, and state is
  not a template.
- **`gcp-infra/README.md`** — an internal operations runbook carrying live node addresses and
  cluster topology. It documents a specific deployment rather than the template.
- **Nextflow work directories and `.nextflow.log*`** — run residue.
- **PBS and SLURM provisioning** — `PbsCluster.ts`, `SlurmCluster.ts` and their eight cloud-init
  files, plus the `slurm*`/`pbs*` configuration keys and stack outputs. The manuscript names
  SLURM only as a prose comparator and defers the head-to-head benchmark to a follow-on study
  (§4.2), so no PBS or SLURM cluster is deployed or validated here. Keeping the code would
  invite a reviewer to look for results that do not exist.
- **`traefik.hcl`, `tusd.hcl`, `web.hcl`** — reverse proxy, upload server and a web app. Platform
  services unrelated to the validation.
