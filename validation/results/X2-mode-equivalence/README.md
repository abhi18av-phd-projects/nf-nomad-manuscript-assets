# X2 — work-directory mode equivalence (Fusion vs nf-nomad-s5cmd)

**Run date:** 2026-08-13. **Verdict: the modes are interchangeable.** Every sequence
output is bit-identical between the two object-store work-directory mechanisms.

## Design

One variable: how the work directory is provided. Everything else is held constant, and
the arms were run **sequentially** rather than concurrently so neither competed with the
other for cores or object-store bandwidth.

| | Arm A | Arm B |
|---|---|---|
| Work directory | S3 via **Fusion** + Wave | S3 via **`nf-nomad-s5cmd`** |
| Container privilege | privileged (FUSE mount) | unprivileged |
| Pipeline | `nf-core/detaxizer` 1.3.0, `-profile test` | identical |
| Cluster, inputs, images | identical | identical |
| `--outdir` | node-local path | node-local path |

Publishing to a **local** `--outdir` rather than `s3://` is deliberate: Nextflow's own AWS
SDK fails on `putObject` retries against this endpoint
(`IllegalStateException: Content input stream does not support mark/reset, and was already
read once`), which is a defect in the publish path and unrelated to the work-directory
mode under test. Keeping it local removes that confound from the comparison.

Both arms set `NXF_TEMP` to node-local disk. Without it, `collectFile()` — which has no
`storeDir` in the standard nf-core template — tries to create its temporary directory
*under* the work directory, and on an object-store work directory that `mkdir` fails
before any task is submitted.

## Runtime

| | Arm A (Fusion) | Arm B (s5cmd) |
|---|---|---|
| Exit status | 0 | 0 |
| Wall-clock | 661 s | 643 s |
| Tasks completed | 54 | 54 |
| Output files | 68 | 68 |

The 18 s difference is a single paired run and carries no performance claim.

## Correctness

Manifests: `e2-fusion-digests.tsv`, `e2-s5cmd-digests.tsv` (64 files each), produced by
`../../scripts/output_digests.py`.

| Class | Bit-identical | Different |
|---|---|---|
| **Sequence outputs** (`.fastq.gz`) | **7 / 7** | **0** |
| QC / reports (MultiQC, FastQC) | 26 | 27 |
| Data tables | 0 | 4 |
| Other | — | — |

**Every sequence output — the filtered and classified reads the pipeline exists to
produce — is bit-identical across the two modes.**

### Why the remaining files differ

The differences are path-bearing, not biological.

Three of the four differing tables are **generated downstream samplesheets**
(`downstream_samplesheets/mag-pe.csv`, `mag-se.csv`, `taxprofiler.csv`) whose rows contain
absolute output paths. Two runs writing to different directories cannot produce identical
files here, by construction. The fourth, `summary/summary.tsv`, carries per-run
provenance.

The QC differences are the familiar MultiQC/FastQC pattern: embedded timestamps, paths and
plot metadata. That 26 of 53 are nonetheless identical rules out systematic corruption.

> **This table understates the agreement.** `output_digests.py` normalises ISO dates but
> **not absolute paths**, because its rules were written for MTBseq-nf's outputs. A
> path-normalisation rule would reclassify all four data tables and most of the QC files
> as volatile-only rather than genuinely different. The honest reading is that no output
> representing a biological result differs; the reported counts are conservative.

## Claim this supports

> Executing the same pipeline through Fusion and through `nf-nomad-s5cmd` produces
> bit-identical sequence outputs. Both arms completed all 54 tasks without failure. The
> only differing files carry absolute paths or run timestamps, which cannot match between
> two runs writing to different directories. The work-directory mechanism is therefore
> interchangeable from the point of view of the analytical result.

## Scope and limits

- **One pipeline, `-profile test` scale.** This is a small workload by design.
- **`test_full` was attempted and does not extend this result.** At that scale both arms
  fail on the same process with tasks exiting 0 and their outputs not visible to Nextflow.
  Because the failure is identical under two mechanisms that share almost no code path,
  it is not attributable to either work-directory implementation, and it is tracked
  separately rather than treated as an E2 finding. See
  `2026-08-14-e2-mode-equivalence-and-the-missing-output-signature.md` in the project
  brainstorms.
- **A second pipeline.** E1 uses MTBseq-nf; E2 uses `nf-core/detaxizer`. MTBseq-nf could
  not be used here: it does not currently complete on either object-store mode on this
  cluster, for two unrelated reasons.

## Contents

| File | What |
|---|---|
| `e2-fusion-digests.tsv`, `e2-s5cmd-digests.tsv` | SHA-256 manifests, raw and normalised |
| `e2-fusion/execution_trace-e2dtx-fusion.txt` | per-task trace, Fusion arm |
| `e2-s5cmd/execution_trace-e2dtx-s5cmd.txt` | per-task trace, s5cmd arm |

Reproduce the comparison:

```bash
../../scripts/output_digests.py --compare e2-fusion-digests.tsv e2-s5cmd-digests.tsv
```
