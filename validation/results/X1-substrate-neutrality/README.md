# X1, substrate neutrality: does running through Nomad change the result?

Run date: 2026-08-06. Verdict: substrate-neutral. The biological result is
unchanged by the execution substrate; the residual difference is smaller in scope
than the pipeline's own published run-to-run variation.

## Design

Two arms, **same node, same data, same container images, same pipeline revision**.
The *only* variable is the execution substrate.

| | Arm A | Arm B |
|---|---|---|
| Substrate | Nextflow **local executor**, no Nomad in the path | Nextflow + **nf-nomad** |
| Launch | plain `nextflow run` on the host | `nomad job run` head job (the reviewer path) |
| Work dir | node filesystem | same filesystem via a host volume |
| Pipeline | `mycobactopia-org/MTBseq-nf` **v1.0.0**, `--parallel true` | identical |
| Data | 5 samples, ENA `PRJEB7727`, pre-staged to node-local disk | identical bytes |
| Images | pre-pulled `mtbseq:1.1.0`, `fastqc`, `multiqc` | identical |
| Resource ceiling | 16 cpus / 48 GB | identical |

Both arms ran 41 tasks, the full parallel decomposition (per-sample
TBBWA → TBLIST → TBPILE → TBREFINE → TBVARIANTS, then the cohort steps
TBSTATS/TBSTRAINS/TBJOIN/TBAMEND/TBGROUPS).

## Runtime

| | Arm A (local) | Arm B (nf-nomad) |
|---|---|---|
| Exit status | 0 | 0 |
| Wall-clock | 2,989 s (49.8 min) | **2,863 s (47.7 min)** |
| Trace span | 2,977.7 s | 2,832.0 s |
| Tasks | 41 | 41 |
| Placement latency **p50** | **0.08 s** | **4.80 s** |
| p95 / p99 / max | 0.09 / 0.09 / 0.09 s | 40.9 / 49.0 / 49.0 s |

Orchestration adds a median ≈4.7 s per task to reach a running state, the
local executor forks a process (0.08 s), Nomad must evaluate, place and start an
allocation. Despite that per-task cost, end-to-end wall-clock did not regress;
arm B finished 126 s (4.2 %) sooner. On a 41-task workflow the scheduling overhead
is absorbed by concurrency, so it does not accumulate into the critical path.
This is a single paired run, so the 4.2 % should be read as *"no wall-clock
penalty observed"*, not as a claim that Nomad is faster.

## Correctness

Digest manifests: `armA-digests.tsv`, `armB-digests.tsv` (115 output files each),
produced by `../../scripts/output_digests.py`, compared with its `--compare` mode.

| Class | Result |
|---|---|
| Files bit-identical | **59** |
| Files differing | 56 |
| **Biological result tables** (`.tab`/`.fasta`/`.matrix`/`.groups`) | **28 total — 27 identical, 1 differing** |

Identical across substrates, byte for byte, including every headline result:
`tbjoin` joint variant table, `tbstats` Mapping_and_Variant_Statistics,
`tbstrains` Strain_Classification, `tbgroups` matrix and groups, and all
`tbamend` phylogeny outputs (`_u95_phylo`, `_w12`, the FASTAs).

The 56 differing files are **intermediates and reports, not results**:
alignment/recalibration artefacts (`.bam`, `.bai`, `.grp`, `.bamlog`,
`.mpileuplog`, 40 files), FastQC/MultiQC HTML and ZIP reports (13), and one
`.json`/`.txt`. BAMs are expected to differ: parallel alignment does not fix read
order, and headers embed run-specific provenance.

### The one differing result table, and why it is not a substrate effect

`tbamend/Amend/..._amended.tab` differs in **174 of 4,899 rows (3.55 %)**.
Critically:

- **0 rows differ in genomic position.**
- Differences are confined to two summary columns (indices 12–13, ahead of the
  per-sample blocks that start at column 18).
- The changes are **threshold flips**: `gap ↔ base` and `SNP ↔ none`/`Del`, the
  signature of a ±1–2 read coverage difference crossing MTBseq's coverage and
  frequency cutoffs, amplified by the amend step's `u95`/frequency thresholds.

To test whether this is caused by the *substrate*, the same file was compared in
the published reference data (Zenodo DOI 10.5281/zenodo.14678757), between its
own serial and parallel runs, same machine, same year, no Nomad anywhere:

| Comparison | Rows differing | Position diffs | Columns affected |
|---|---|---|---|
| **Published reference**: serial vs parallel (no Nomad) | 161 / 4,899 = **3.29 %** | 0 | 12, 13, 16, 20–24 |
| **This experiment**: local vs nf-nomad | 174 / 4,899 = **3.55 %** | 0 | 12, 13 |

The substrate comparison lands **inside the pipeline's own published
run-to-run envelope**, a nearly identical difference rate (3.55 % vs 3.29 %),
zero position differences in both, and affecting fewer columns than the
published non-Nomad comparison. Both show exactly 13 rows differing in column 12.

Conclusion. The residual variation is intrinsic non-determinism of parallel
alignment/pileup (BWA/GATK threading), *not* an effect of the execution
substrate. It is present in the pipeline's own published results with no
orchestrator involved, at the same magnitude.

## Claim this supports

> Executing the pipeline through the Nomad executor rather than Nextflow's local
> executor leaves the biological result unchanged: 27 of 28 result tables are
> bit-identical, and the single remaining table differs only in threshold-sensitive
> summary columns at a rate (3.55 % of rows, no positional differences)
> indistinguishable from the pipeline's own serial-vs-parallel variation in its
> published reference data (3.29 %). Orchestration costs a median 4.8 s per task
> to place, with no observed end-to-end wall-clock penalty on a 41-task workflow.

## Contents

| File | What |
|---|---|
| `armA/execution_trace-armA.txt` | per-task trace, local executor |
| `armB/execution_trace-armB.txt` | per-task trace, nf-nomad |
| `armA-digests.tsv`, `armB-digests.tsv` | SHA-256 manifests (raw + normalised) |
| `x1-runtime-summary.tsv` | derived runtime / placement-latency percentiles |
| `publication.05samples.*.csv/tsv` | sample sheet + cohort file used |

Reproduce the comparison:
```bash
../../scripts/output_digests.py --compare armA-digests.tsv armB-digests.tsv
../../scripts/trace_metrics.py armA/execution_trace-armA.txt armB/execution_trace-armB.txt
```

Acceptance criteria and the normalisation rules are defined in
`../X1-reference-baseline/README.md`.

---

# X1 at full scale, 90 samples

Run dates: arm A 2026-08-07/08, arm B 2026-08-09/10. **Verdict: substrate-neutral,
and more tightly so than the 5-sample pilot.** Same design as above: two arms, same node,
same data, same images, same pipeline revision; the execution substrate is the only
variable. Both arms completed **636/636 tasks with zero failures**.

## Runtime

| | Arm A (local) | Arm B (nf-nomad) |
|---|---|---|
| Exit status | 0 | 0 |
| Tasks | 636 | 636 |
| Wall-clock | 50,118 s (13.9 h) | **30,938 s (8.6 h)** |
| Placement latency p50 | 0.09 s | 35.22 s |
| p95 / p99 / max | 0.09 / 0.10 / 0.10 s | 509.5 / 789.4 / 1082.3 s |

Two cautions on these numbers, both load-bearing.

*The 38 % wall-clock difference is not a speed claim.* Arm A ran while the work volume was
filling toward capacity and arm B ran with substantially more free space, so I/O pressure
differs between the arms. This is a single paired run with an uncontrolled confound. What
it supports is the same statement the pilot supported, **no wall-clock penalty from
orchestration**, not that Nomad is faster.

*The placement percentiles measure something different here than at 5 samples.* At 90
samples the node is saturated, so `start − submit` is dominated by queue wait, not
scheduling overhead: with `queueSize = 12` and the default `cores` CPU mode reserving four
exclusive cores per task, tasks legitimately wait for cores to free. The 5-sample p50 of
4.8 s is the better estimate of orchestration cost. A p95 of 509 s must not be read as
half an hour of scheduling overhead.

## Correctness

Manifests: `armA90-digests.tsv`, `armB90-digests.tsv`, 1,645 files each.

| Class | Bit-identical | Identical after normalisation | Different |
|---|---|---|---|
| **Result tables** (`.tab`/`.fasta`/`.matrix`/`.groups`) | **279** | **2** | **2** |
| Alignment artefacts (`.bam`/`.bai`/`.grp`/`.bamlog`) | 0 | 0 | 720 |
| QC reports (FastQC/MultiQC HTML+ZIP) | 1 | 0 | 361 |
| Other | 276 | 0 | 4 |

281 of 283 result tables agree, including every headline output: the `tbjoin` joint
variant table, `tbstats` statistics, `tbstrains` classification, and the `tbamend`
phylogeny FASTAs. The two normalised-only cases (`Mapping_and_Variant_Statistics.tab`,
`Strain_Classification.tab`) differ solely in run-specific stamped fields.

Alignment artefacts and QC reports differing is expected and not a substrate effect:
parallel alignment does not fix read order, BAM headers embed run-specific provenance, and
FastQC output embeds timestamps and paths.

### The two differing result tables

**`tbgroups/…_w12_d12.groups`, identical clustering, different labels.** Both arms produce
9 groups with identical membership sets (verified as sets: zero groups unique to
either arm). Only the arbitrary group numbering differs, the same trio is `group_5` in one
arm and `group_6` in the other. There is no biological difference here.

`tbamend/…_amended.tab`, 53 of 23,643 rows (0.22 %). Critically:

- **0 rows differ in genomic position.**
- Differences are confined to columns 12–13, the same two threshold-sensitive summary
  columns identified in the 5-sample pilot.

This is the same signature as the pilot and **an order of magnitude smaller**: 0.22 % of
rows at 90 samples versus 3.55 % at 5 samples, against the published reference's own
serial-vs-parallel divergence of 3.29 %. The residual is intrinsic non-determinism of
parallel alignment and pileup, not an effect of the execution substrate.

## Claim this supports

> At 90 samples, executing the pipeline through the Nomad executor rather than Nextflow's
> local executor leaves the biological result unchanged. Of 283 result tables, 281 agree, > 279 bit-identical and two identical once run-specific stamped fields are normalised. Of
> the remaining two, one differs only in arbitrary cluster labelling with identical group
> membership, and the other differs in 0.22 % of rows confined to two threshold-sensitive
> summary columns, with no differences in genomic position. Both arms completed 636 of 636
> tasks without failure.

## Reproduce

```bash
../../scripts/output_digests.py --compare armA90-digests.tsv armB90-digests.tsv
../../scripts/trace_metrics.py armA90/execution_trace-armA90.txt armB90/execution_trace-armB90.txt
```
