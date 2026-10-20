# E1 reference baseline, published mtbseq-nf results

Ground truth for the substrate-neutrality experiment (E1), taken from the
published MTBseq-nf supplementary dataset:

> *MTBseq-nf publication supplementary material with results of all individual
> experiments.* Zenodo, 2025-01-17. DOI **10.5281/zenodo.14678757**. CC-BY-4.0.

`reference-05samples-digests.tsv` is the SHA-256 manifest of the 5-sample run
(`pub-05samples.zip`), produced by `../../scripts/output_digests.py`. It carries
both a raw digest and a normalised digest per file.

## Why E1 compares against this, not just arm A vs arm B

The published archive also contains 3 replicate runs at 90 samples for *both*
mtbseq-nf and standard (non-Nextflow) MTBseq. That makes the correctness check
three-way rather than two-way: **published reference ↔ arm A (local executor) ↔
arm B (nf-nomad)**. A result that matches the reference on a completely different
substrate, machine and year is far stronger evidence for substrate neutrality
than two arms agreeing with each other on one node.

## The volatility that would otherwise sink the digest claim

MTBseq writes a `Date` column into its `.tab` tables (`'2024-09-09` in the
reference). Raw SHA-256 of those files therefore can never match across runs
on different days, regardless of whether the biology is identical. Verified
against this dataset by re-dating a copy: 28/30 files stayed bit-identical, and
the 2 date-bearing tables differed raw but were identical once normalised.

So the E1 acceptance criterion must be stated as:

- **bit-identical for all outputs without run-stamped fields, and**
- **identical after declared normalisation** for those with them, with the
  normalisation rules enumerated (they are, in `output_digests.py: RULES`).

This is separate from, and additional to, the genuine tool non-determinism the
experiment plan already requires enumerating (e.g. GATK HaplotypeCaller,
parallel BWA-MEM), which must be handled by pinning seeds/threads rather than by
normalisation.

## Reference run characteristics

15 tasks, all `COMPLETED` (5 samples: RENAME_FILES + FASTQC per sample, then the
cohort steps TBFULL → TBJOIN → TBAMEND → TBGROUPS).

⚠ The reference trace uses Nextflow's default trace fields, `submit`,
`duration`, `realtime`, but no `start`/`complete`, so **placement latency is
not derivable from it**. Our runs request the full field set
(`../../configs/nextflow.trace.config`); the reference can only supply task
durations for runtime comparison.

---

## Parallel mode is the campaign default, and it re-frames the correctness claim

All campaign runs use **`--mtbseq_parallel true`**. The publication established
that parallel and serial modes are equivalent, and parallel mode decomposes
MTBseq into per-sample steps, so it exercises the executor far harder:

| Mode | Tasks (5 samples) | Processes |
|---|---|---|
| serial | 15 | RENAME_FILES, FASTQC ×5 + 4 monolithic cohort steps |
| **parallel** | **41** | + TBBWA, TBLIST, TBPILE, TBREFINE, TBVARIANTS ×5, then TBSTATS/TBSTRAINS/TBJOIN/TBAMEND/TBGROUPS |

At 90 samples that is ≈455 tasks, a far better basis for placement-latency
statistics than 15. The correct baseline for our runs is therefore
`reference-05samples-parallel-digests.tsv` (from `pub-05samples-parallel.zip`).

### The empirical non-determinism envelope (measured, not assumed)

Digesting the published serial and parallel references against each other gives
the *expected* spread for this pipeline, established independently of anything we
run. On the joint variant table (`tbjoin/.../samples5.tab`):

| Measure | Value |
|---|---|
| rows | 4,899 (identical count in both) |
| rows differing at all | **11 (0.22 %)** |
| rows where the **position** differs | **0** |
| rows where the **variant call** differs | **0** |
| columns that differ | read-depth / coverage counts only (±1–2 reads) |

Across the whole output set: 19 files bit-identical, 9 differing only in these
depth counts, 4 present under different paths (serial writes `tbfull/Statistics`
and `tbfull/Classification`; parallel writes `tbstats/Statistics` and
`tbstrains/Classification`, same content, different layout).

Consequence for E1's acceptance criterion. "Bit-identical outputs" is the
wrong bar for this pipeline and would fail for reasons unrelated to the
substrate. State it in three tiers instead:

1. Bit-identical, for outputs with no run-stamped or depth-derived fields.
2. Identical after declared normalisation, for files carrying the `Date`
   stamp (rules in `../../scripts/output_digests.py: RULES`).
3. Call-concordant, for alignment-derived tables, *identical variant
   positions and calls*, with coverage counts allowed to vary within the
   envelope above. This is the intrinsic thread non-determinism of parallel
   alignment/pileup that the experiment plan requires be enumerated rather than
   waved at; it is a property of BWA/pileup threading, not of the executor.

E1 therefore claims substrate neutrality of the biological result, evidenced
by identical calls across arms, with the coverage-count spread reported and
bounded by the published reference's own serial-vs-parallel spread.

---

## Run-configuration findings (E1 execution, 2026-08-06)

Four things had to be right before either arm produced a valid run. Each failed
fast and cheaply, but each would have invalidated a long run silently:

1. **The pipeline needs the legacy config parser, even though the plugin does
   not.** `MTBseq-nf v1.0.0`'s own `nextflow.config` defines Groovy functions
   (`def check_max(obj, type)`), which Nextflow 26.x's strict parser rejects
   (`Unexpected input: '('`). So `NXF_SYNTAX_PARSER=v1` is required *by the
   pipeline*, not by nf-nomad, the plugin's own config is strict-parser-native
   since upstream PR #132. Worth separating in the paper: the executor is ready
   for the new parser; the existing pipeline ecosystem largely is not.
   It is applied identically to both arms, so it cannot bias the comparison.

2. The parallel-mode parameter was renamed after the release. In `v1.0.0`
   the switch is `--parallel`; it became `--mtbseq_parallel` on later
   commits. Passing the newer name to `v1.0.0` is silently ignored, Nextflow
   accepts the unknown param and the run proceeds in serial mode
   (`TBFULL`) instead of parallel (`TBBWA`/`TBLIST`/`TBPILE`/`TBREFINE`/
   `TBVARIANTS`). Detected only by inspecting which processes were submitted.
   **Always verify the emitted process names match the intended mode.**

3. **Both arms must read the same bytes, but not the same path string.** Arm A
   runs on the host; arm B runs in containers where the volume is mounted
   elsewhere. Two sample sheets are therefore generated from one staged copy of
   the data, identical content, different path prefix.

4. Verify staged data integrity before starting. One of ten FASTQs completed
   the transfer truncated (14 MB vs 64 MB) and failed `gzip -t`. A `gzip -t`
   sweep over the staged inputs costs seconds and prevents a multi-hour run
   failing partway, or worse, succeeding on truncated input.

Related, from generating the sample sheet: Python's `csv.writer` emits CRLF
by default, which put a trailing `\r` on every `fastq_2` URL and silently broke
those downloads (`curl: (3) URL using bad/illegal format`). Sample sheets must be
written with Unix line endings.
