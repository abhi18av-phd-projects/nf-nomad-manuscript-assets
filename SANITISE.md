# Migration and sanitisation manifest

What must be scrubbed before each template source moves into this repository. Derived from a
scan of the working tree at `PHD-pub-nf-nomad/analysis/infrastructure/03_automation/`.

**Nothing listed here has ever been committed anywhere.** Every finding below is an untracked,
gitignored file on a local disk, verified at zero commits in history. This is a pre-publication
checklist, not an incident log.

## Findings requiring action

| Source | Finding | Action |
|---|---|---|
| `034_pulumi/gcp-infra/.tmp-nextflow-head.hcl` | Literal Nomad ACL token (`TOKEN = "55099fae-…"`), a stray temp artefact dated 2026-03-24 | **Rotate the token**, then delete the file. Do not migrate. |
| `034_pulumi/oracle-infra/Pulumi.dev.yaml` | Real OCI compartment and tenancy OCIDs | Replace with `ocid1.compartment.oc1..<YOUR_COMPARTMENT>` placeholders |
| `034_pulumi/*/id_ed25519`, `id_ed25519.pub` | SSH keypairs, incl. two **private** keys | Never migrate. Templates must generate or accept a key at deploy time. |
| `034_pulumi/*/node_modules/` | ~1.6 GB of dependencies | Never migrate. `package.json` + lockfile only. |
| `034_pulumi/*/` LevelDB files (`MANIFEST-*`, `LOCK`, `CURRENT`, `*.ldb`) | Pulumi local-backend **state** | Never migrate. State is not a template. |
| `spot-compute/Pulumi.seedling-prod.yaml` | `tskey-auth-XXXX` | Already redacted upstream — carry the placeholder form. |

## Safe as-is

`Gcp.ts`, `NomadServer.ts` and `minio.hcl` reference secrets only through variables
(`autoscalerNomadToken`, `${minioSecretKey}`), which is the correct pattern and needs no change.

## Source map

| This repo | Migrates from |
|---|---|
| `templates/local-multipass/` | `01_virtualization/013_multipass/` + `03_automation/030_misc_local_nomadlab/` |
| `templates/cloud-oci-gcp/` | `034_pulumi/oracle-infra/` + `034_pulumi/gcp-infra/` + `034_pulumi/spot-compute/` |
| `validation/chaos/` | upstream `nf-nomad/validation/sun-nomadlab/chaos_{job,node}.yml` |
| `validation/configs/` | upstream `nf-nomad/validation/{local,az,sun}-nomadlab/*.config` |

## Procedure

1. Copy **file by file**, never `cp -r` — the noise is 99% of the bytes.
2. Run the secret scan (below) after each addition.
3. Confirm each template still deploys from the sanitised copy before the Zenodo release.

```bash
grep -rniE "(ocid1\.[a-z]+\.[a-z0-9._-]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|tskey-auth-[a-zA-Z0-9]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})" . \
  --exclude-dir=.git --exclude=SANITISE.md
```
