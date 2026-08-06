# X3 — preemption recovery (the number that replaces the unverified "47 s")

**Status: harness built and safety-verified; trials NOT yet run.**

The manuscript currently asserts a median recovery of *47 seconds across 10
preemption trials*. That number is flagged in the claim-evidence matrix as
possibly illustrative — no dataset backs it. X3 exists to produce a real one.
If the measured median differs, **the number changes**; that is the point.

## Why the upstream chaos harness was not used

The campaign inherited `chaos_node.yml` / `chaos_job.yml` from the original lab.
Neither is safe to point at a shared or production cluster, and both were
mis-scoped for this one:

| Harness | Problem |
|---|---|
| `chaos_node.yml` | **Drains whole nodes.** A drain evicts every allocation on the node, not just the pipeline's. Its skiplist names two lab nodes and does **not** cover the node that hosts the platform services here — a run would have taken down the object store, auth service, database, proxies and every deployed app. |
| `chaos_job.yml` | Selects victims by namespace allow/deny list. Its allowlist names a namespace that does not exist on this cluster (so it targets nothing), while its denylist excludes the namespace where the executor's task jobs actually run (so it would skip the intended targets). Inoperative as written, and blast-radius-by-namespace if "fixed" naively. |

Node-level chaos is the wrong instrument for this measurement anyway: X3 asks how
fast the **executor** recovers a **task**, which is answered by killing one task
allocation — not by evicting everything co-located with it.

## The purpose-built harness

`../../scripts/preemption_trial.py`. Measures, per trial:

```
delta = t(replacement allocation running) − t(kill issued)
```

Safety rails, all enforced in code rather than documented as advice:

1. **`--job-prefix` is required** — only jobs whose name starts with it are
   eligible. Scope is one pipeline run, not a namespace.
2. **Denylist abort** — if any candidate job name contains a platform-service
   term (`minio`, `auth`, `pocketbase`, `tusd`, `grafana`, `victoria`, `traefik`,
   `caddy`, `proxy`, `vault`, `consul`, `postgres`, …), the run **aborts** rather
   than skipping. Fail closed, not open.
3. **Dry-run is the default** — `--execute` is required to modify anything; the
   default prints every candidate and exits.
4. **Never touches nodes** — no drain, no cordon, no eligibility changes.
5. **One allocation at a time**, with a settle interval between trials.

Verified against this cluster: aimed at the namespace holding the platform
services, it aborted on the first match (`abc-auth-svc` → term `auth`) and
changed nothing; object store, auth service and database all remained `running`
and S3 health stayed `200`.

## Method (when run)

1. Start a pipeline run long enough to hold running tasks (the X1 5-sample
   parallel workflow: 41 tasks, ~48 min, sustains 5 concurrent per-sample steps).
2. Take the run's task-job prefix from the executor's job naming.
3. `preemption_trial.py --job-prefix <prefix> --trials 10 --execute --out S4-preemption.tsv`
4. Record per trial: kill timestamp, recovery timestamp, delta; plus whether the
   pipeline completed **without intervention**.
5. Report the **median of the measured deltas**, the spread, and any timeouts.

## Caveats to state alongside the number

- Recovery time includes re-placement **and** container start; a task whose image
  is not cached on the replacement node includes the pull. Warm the images first,
  or report cold and warm separately (see the X0 note on image-cache effects).
- Killing an allocation is a *proxy* for preemption. It exercises the same
  detect → reschedule → restart path, but a real preemption also carries the
  preempting workload's scheduling. State this framing explicitly.
- The recovery path depends on the task jobs' reschedule/restart policy, which
  the executor sets. Record that policy alongside the number — it is part of the
  result, not a background detail.
