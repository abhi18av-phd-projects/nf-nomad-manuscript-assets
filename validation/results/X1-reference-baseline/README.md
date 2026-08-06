# X1 reference baseline — published mtbseq-nf results

Ground truth for the substrate-neutrality experiment (X1), taken from the
**published** MTBseq-nf supplementary dataset:

> *MTBseq-nf publication supplementary material with results of all individual
> experiments.* Zenodo, 2025-01-17. DOI **10.5281/zenodo.14678757**. CC-BY-4.0.

`reference-05samples-digests.tsv` is the SHA-256 manifest of the 5-sample run
(`pub-05samples.zip`), produced by `../../scripts/output_digests.py`. It carries
both a raw digest and a **normalised** digest per file.

## Why X1 compares against this, not just arm A vs arm B

The published archive also contains 3 replicate runs at 90 samples for *both*
mtbseq-nf and standard (non-Nextflow) MTBseq. That makes the correctness check
three-way rather than two-way: **published reference ↔ arm A (local executor) ↔
arm B (nf-nomad)**. A result that matches the reference on a completely different
substrate, machine and year is far stronger evidence for substrate neutrality
than two arms agreeing with each other on one node.

## The volatility that would otherwise sink the digest claim

MTBseq writes a **`Date` column into its `.tab` tables** (`'2024-09-09` in the
reference). Raw SHA-256 of those files therefore **can never match** across runs
on different days — regardless of whether the biology is identical. Verified
against this dataset by re-dating a copy: 28/30 files stayed bit-identical, and
the 2 date-bearing tables differed raw but were identical once normalised.

So the X1 acceptance criterion must be stated as:

- **bit-identical** for all outputs without run-stamped fields, **and**
- **identical after declared normalisation** for those with them, with the
  normalisation rules enumerated (they are, in `output_digests.py: RULES`).

This is separate from, and additional to, the genuine tool non-determinism the
experiment plan already requires enumerating (e.g. GATK HaplotypeCaller,
parallel BWA-MEM), which must be handled by pinning seeds/threads rather than by
normalisation.

## Reference run characteristics

15 tasks, all `COMPLETED` (5 samples: RENAME_FILES + FASTQC per sample, then the
cohort steps TBFULL → TBJOIN → TBAMEND → TBGROUPS).

⚠ The reference trace uses Nextflow's **default** trace fields — `submit`,
`duration`, `realtime`, but **no `start`/`complete`** — so **placement latency is
not derivable from it**. Our runs request the full field set
(`../../configs/nextflow.trace.config`); the reference can only supply task
durations for runtime comparison.
