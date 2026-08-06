# nf-sleep-random

A synthetic Nextflow pipeline for **X3, substrate-recovery testing**. Every task sleeps a
seeded pseudo-random duration; none of them compute anything.

```bash
export NOMAD_ADDR=http://127.0.0.1:4646
export NOMAD_TOKEN=$(cat ../local-cluster/.nomad-token)
nextflow run main.nf -c nextflow.config --tasks 60 --min_sec 5 --max_sec 90 --seed 42
```

Then, in another shell, run a preemption trial against it:

```bash
cd ../local-cluster && TRIALS=10 ./scripts/chaos.sh
```

| Parameter | Default | |
|---|---|---|
| `--tasks` | 60 | more tasks → more preemption opportunities per run |
| `--min_sec` / `--max_sec` | 5 / 90 | the duration spread; the spread is the point |
| `--seed` | 42 | fixed seed → identical workload across trials and reviewers |
| `--randomize` | true | `false` gives a uniform-duration control arm |

Each task writes its planned and actual duration plus its allocation ID, so a completed run
also records **which node ran what** — enough to confirm that rescheduled tasks moved.

**Scope.** This measures how the substrate recovers, not whether a pipeline computes the right
answer. Correctness is X1's job, on real pipelines and real data. Say so in S4, or a reviewer
may read a synthetic workload as a biological result.
