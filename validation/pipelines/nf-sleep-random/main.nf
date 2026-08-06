#!/usr/bin/env nextflow
/*
 * nf-sleep-random — a synthetic workload for substrate-recovery testing.
 *
 * Emits N tasks, each sleeping a pseudo-random duration drawn from [minSec, maxSec].
 * Adapted from pditommaso/nf-sleep, following the seeded-randomisation pattern used
 * by the cluster verification workloads.
 *
 * The point is NOT to compute anything. It is to occupy the scheduler with many tasks
 * of differing lifetimes, so that killing a node lands on tasks at every stage of
 * execution — just-started, mid-flight, nearly-finished — and one run yields many
 * reschedule observations instead of one.
 *
 *   nextflow run main.nf --tasks 60 --min_sec 5 --max_sec 90 --seed 42
 *
 * Reproducibility: durations derive from `seed`, so two runs with the same seed
 * present the scheduler with an identical workload. Set --randomize false for a
 * uniform-duration control arm.
 */

nextflow.enable.dsl = 2

params.tasks     = 60
params.min_sec   = 5
params.max_sec   = 90
params.seed      = 42
params.randomize = true

process SLEEP {
    tag "task_${idx}_${secs}s"

    input:
    tuple val(idx), val(secs)

    output:
    path "task_${idx}.done"

    script:
    """
    start=\$(date -u +%s)
    sleep ${secs}
    end=\$(date -u +%s)
    printf 'task\\t%s\\nplanned_sec\\t%s\\nstart\\t%s\\nend\\t%s\\nactual_sec\\t%s\\nnode\\t%s\\n' \\
        "${idx}" "${secs}" "\$start" "\$end" "\$(( end - start ))" "\${NOMAD_ALLOC_ID:-local}" \\
        > task_${idx}.done
    """
}

workflow {
    def rng = new Random(params.seed as long)
    def span = (params.max_sec as int) - (params.min_sec as int)

    def work = (1..(params.tasks as int)).collect { i ->
        def secs = params.randomize
            ? (params.min_sec as int) + rng.nextInt(span + 1)
            : ((params.min_sec as int) + (params.max_sec as int)).intdiv(2)
        tuple(i, secs)
    }

    SLEEP(Channel.fromList(work))
}
