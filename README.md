# nf-nomad manuscript assets

Deployment templates, validation configurations and a reviewer protocol for **nf-nomad**, the Nextflow
executor plugin for HashiCorp Nomad.

This repository is the companion artefact to the nf-nomad manuscript. It exists so that a
reviewer, or anyone else, can go from a bare machine to a running nf-core pipeline on Nomad
without reconstructing the environment from prose.

> **Status: complete.** Templates, validation configurations, measured results and the reviewer
> protocol are in place. Cloud credentials are never committed; every template takes them at
> deploy time.

## What is here

| Path | Contents |
|---|---|
| `templates/local-docker/` | One machine, one Nomad server and N clients in containers. Docker is the only prerequisite. |
| `templates/cloud-gcp/` | A GCP preemptible spot fleet joined by an overlay network. Demonstrates the heterogeneous-pool and preemption claims. |
| `validation/configs/` | A `nextflow.config` per work-directory mode — shared POSIX, Fusion, `nf-nomad-s5cmd`. |
| `validation/chaos/` | Node- and job-level preemption harness for the robustness experiment. |
| `protocol/` | Step-by-step reviewer protocol, below. |

## The reviewer protocol

Three steps, each with an expected result you can check.

1. **[Provision](protocol/01-provision.md)** — bring up a cluster from one template.
2. **[Run](protocol/02-run-pipeline.md)** — execute one nf-core pipeline against it.
3. **[Verify](protocol/03-expected-output.md)** — compare what you got against what we got.

The local template is the intended starting point: it needs no cloud credentials, and it is
also the CI environment for the plugin itself.

## What this is not

These templates provision **evaluation and validation environments**. They are not a
production deployment system, and they deliberately omit the multi-tenant policy,
admission-control and audit layers that a shared institutional cluster needs. Those live
in a separate platform codebase and are out of scope here.

## Security

Nothing in this repository contains credentials, keys, state, or tenancy identifiers.
The `.gitignore` blocks them by pattern, and every file was reviewed before inclusion.
Where a template needs a secret, it reads it from the environment or a Pulumi config
value, and the committed example shows a placeholder.

If you find anything that looks like a real credential, please open an issue rather
than a pull request.

## Citing

This repository is archived on Zenodo and released under Apache-2.0, matching nf-nomad
itself. See [`CITATION.cff`](CITATION.cff).

## Related

- **nf-nomad** — <https://github.com/nextflow-io/nf-nomad>
- **nf-nomad-s5cmd** — the S3 work-directory provider
- Upstream `validation/` in the nf-nomad repository holds the per-feature configuration
  suite (constraints, directives, secrets, spread, volumes) that this repository does not
  duplicate.
