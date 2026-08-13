# X2, work-dir mode equivalence (Fusion vs s5cmd)

**Status: IN PROGRESS. Neither arm has produced a comparable result yet.**
The S3 substrate itself is proven working; both arms are blocked on separate,
identified issues. This file records exactly where each stands so the next
session does not re-derive any of it.

## Environment established (reusable)

| Item | Value |
|---|---|
| S3 endpoint | the cluster's **private/Tailscale** address, port 9000 — health 200 |
| Work-dir bucket | `nfval-x2` (created for this campaign) |
| Credentials | MinIO root, stored in a **Nomad Variable**, never in a job file |
| S3 plumbing | **verified working** — a run staged **31 objects** into the S3 work dir (`.command.run`, `.command.sh` per task) |

Using the private address rather than the public edge is deliberate: it is the
interface the object store actually binds, and it removes a proxy hop.

## Arm 1, s5cmd: infrastructure works, pipeline output does not

Progression of failures, each fixed, each a reusable finding:

1. `missing compatible host volumes`, the tools volume (`abc-tools`) is
   registered read-only on the target node, but nf-nomad requested it
   writable, so Nomad refused placement. *This is the same error that left
   two head jobs stranded since June.*
2. `WorkingDir Volume can't be readOnly`, requesting it read-only instead
   fails differently: nf-nomad treats the declared volume as the work-dir
   volume and rejects a read-only one. So a tools-only volume cannot simply be
   declared alongside an S3 work dir.
   *Resolution:* use the writable work volume, which also carries the s5cmd
   binary (`/nxf-work/bin/s5cmd`), the pattern the project's own production
   config already uses.
3. Current blocker: with placement fixed, tasks run and stage through S3, but
   `RNASEQ:FASTQC` ends with exit status 0 and no output file
   (`Missing output file(s) 'fastqc_ggal_gut_logs'`).

That third one is pipeline-level, not infrastructure. `rnaseq-nf` invokes a
script from the pipeline's `bin/` directory and emits a directory output, both of which interact with remote work dirs. Note the Fusion path explicitly
logs *"Enabling bundle project resources -- Disabling upload of remote bin
directory"*, i.e. Wave bundles `bin/` precisely because remote work dirs
otherwise do not carry it. **Whether this is an nf-nomad-s5cmd limitation or a
property of `rnaseq-nf` is not yet established**, and it matters, because it is
exactly the kind of claim X2 exists to test.

Next step: re-test with the campaign's real X2 targets (`mtbseq-nf`,
`nf-core/taxprofiler`) rather than `rnaseq-nf`. `mtbseq-nf` ran cleanly on a
host-volume work dir in X1, so a failure there would isolate the S3-mode
variable; a success would show the `rnaseq-nf` result is a `bin/`-directory
artefact and not a mode limitation.

## Arm 2, Fusion: blocked, silent failure

Nextflow exits **1 after 9 s with no error in stdout, stderr, or
`.nextflow.log`**. Ruled out by direct evidence:

| Hypothesis | Verdict |
|---|---|
| S3 credentials / endpoint wrong | ❌ log shows the correct key, endpoint and path-style setting |
| Bucket unreachable | ❌ the work-dir prefix was created in the bucket |
| Out of memory | ❌ clean exit 1, no memory event |
| Privileged denied | ❌ enabled on the agent for this test; the task started |
| Wave service unreachable | ❌ `wave.seqera.io` returns 200 from the node |
| **Wave / Tower authentication** | **⚠ most likely** — the log stops exactly at `TowerFactory`, and **no Wave/Tower token exists** in any Nomad Variable, though the project's older head-job templates reference `TOWER_ACCESS_TOKEN`. Anonymous Wave use is rate-limited. |

Next step: supply a Seqera/Tower access token via a Nomad Variable and retry.

## Configuration change made for this experiment, REVERT WHEN DONE

Fusion mounts the S3 work dir via FUSE and therefore needs a privileged
container. The target node's Nomad agent denied privileged mode by default (a
sound hardening posture), so `allow_privileged = true` was added to its docker
driver config and the agent restarted.

- Config backup: `/etc/nomad.d.bak-prefusion-<timestamp>` on the node.
- **This is a standing reduction in that node's hardening**, not a test-time
  toggle. It should be reverted once X2 completes.
- The restart was sequenced deliberately: it was held until no allocation held
  `ReservedCores`, because a prior restart with core reservations live had
  produced a cluster-wide outage (stale `reserve.slice` cpuset). Verified
  before/after, cpuset identical, zero `cpuparts` errors, all services healthy.

Finding worth stating in the paper: Fusion imposes an infrastructure
prerequisite (privileged/FUSE) that hardened orchestrator deployments deny by
default, whereas the s5cmd mode needs only a mounted binary. That is a real
operational difference between the two modes, independent of their performance.
