# Registry survey, executor plugins in the Nextflow plugin registry

Retrieved: 2026-08-09 · Source: `https://registry.nextflow.io/api/v1/plugins?size=500`
(plus `/api/v1/plugins/<id>` per plugin for provider and description).

Official plugin index only. The registry object also carries a `downloadGhCount`
field recording downloads from the legacy GitHub distribution path. It is **excluded
from every figure here**, deliberately: the two counters measure different eras and
different distribution channels, their ratio varies by an order of magnitude with
plugin age, and mixing them would make the numbers uninterpretable. Only
`downloadCount`, the registry's own counter, is used.

## Contents

| File | What |
|---|---|
| `registry-snapshot-2026-08-09.json` | Full index snapshot: all 92 plugins with `downloadCount`, `provider`, `projectUrl`, release count, latest version/date, and concatenated release descriptions |
| `executor-plugins-2026-08-09.tsv` | Derived table: the 25 executor plugins, ranked, with the evidence basis for each classification |

## Method

1. Enumerate every plugin in the index (`?size=500`; the default page size is 20, which
   silently truncates at `nf-command-archiver`, a trap worth noting for anyone
   reproducing this).
2. Fetch each plugin's detail record for `provider` and per-release `description`.
3. Classify as an executor on two tiers of evidence, kept separate rather than merged:
   - **Tier A, index description.** The plugin's own registry description states that it
     provides or extends a Nextflow executor. 10 plugins.
   - **Tier B, registry provider.** No description is published, but the index's
     `provider` field attributes the plugin to a compute-platform vendor and the plugin
     name denotes that platform. 15 plugins. Weaker evidence; reported separately and
     never silently pooled with Tier A.

Three plugins matching the string *executor* were excluded as false positives:
`nf-wave`, `nf-cgroup-metrics` and `nf-llm-debugger` mention it only inside example
configuration or captured log output, not as a capability they provide.

## Headline figures

| | |
|---|---|
| Plugins in the index | **92** |
| Total registry downloads | **2,597,428** |
| Executor plugins | **25 (27 %)** |
| Tier A downloads | 950,294 (36.6 % of all plugin downloads) |
| Tier B downloads | 5,685 (0.2 %) |
| **nf-nomad rank** | **6th of 25 executors; 20th of 92 plugins** |
| Top-3 executor share | 93.3 % |
| nf-amazon share of executor downloads | 80.9 % |

## Interpretation limits

These are **download counts, not usage**. They cannot be read as distinct users, sites
or pipeline runs:

- Continuous-integration pipelines re-download plugins on every run; there is no
  deduplication by user or machine.
- **`nf-amazon` is not an executor signal.** It bundles the S3 filesystem, so any
  pipeline reading an `s3://` path pulls it regardless of which executor is configured.
  Its 80.9 % share overstates AWS Batch use by an unknown margin.
- Plugin age confounds cumulative totals: a plugin published to the registry recently
  has had less time to accumulate downloads than one carried over from the GitHub era.
- Tier B classifications rest on provider attribution plus the plugin name, not on a
  declared capability.

The defensible claim is **ordinal, not proportional**: the ranking of executor plugins
and the presence or absence of a target platform, not the ratio between any two counts.

## What the survey shows

Traditional HPC schedulers are absent from the registry by construction, SLURM,
PBS Pro, LSF, SGE, HTCondor and Moab are implemented in the Nextflow distribution
itself, not as plugins. What the registry records is therefore the set of *newer*
execution targets, and that population is dominated by managed cloud batch services
(AWS, Google, Azure, Databricks, Snowflake, Tencent) and vendor compute clouds
(MemVerge, Fovus, Nimbix, YellowDog). Only site-specific scheduler variants appear, `nf-gadi` (NCI Australia's PBS), `nf-slurm-no-memory`, `nf-ospool` (an HTCondor pool).

Against that distribution, Kubernetes (`nf-k8s`) and Nomad (`nf-nomad`) are the only
two executor targets that are general-purpose, self-hostable orchestrators, neither a
managed cloud batch service nor a site-specific HPC scheduler.

## Reproduce

```bash
curl -s 'https://registry.nextflow.io/api/v1/plugins?size=500' -o index.json
# then per-plugin: https://registry.nextflow.io/api/v1/plugins/<id>
```
