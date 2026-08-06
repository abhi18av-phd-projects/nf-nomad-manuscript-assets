# spot-compute — autoscaled GCP spot compute for a prod Nomad cluster

A standalone Pulumi project that adds **elastic GCP spot capacity** to an
existing prod Nomad cluster (default: `abc-seedling-prod`, server = aither) as
`node_pool=compute` clients — to relieve pressure on the on-prem nomadlab nodes.
Isolated from the `gcp-infra` research stack (no shared state).

## Architecture

```
                    Tailscale mesh
   ┌─────────────┐      (overlay)        ┌──────────────────────────────┐
   │   aither    │◄──────────────────────│  spot MIG instances (SPOT)   │
   │ Nomad server│  client RPC :4647     │  node_pool=compute           │
   │ region      │                       │  node_class=gcp-spot-<size>  │
   │ "global"    │◄───────┐              │  host_volume nf-work, docker │
   └─────────────┘  HTTP  │              └──────────────────────────────┘
        ▲          :4646  │                         ▲ scale
        │ APM (read)      │                         │ (gce-mig)
        │          ┌──────┴───────────┐             │
        └──────────│ autoscaler VM    │─────────────┘
                   │ nomad-autoscaler │  (always-on e2-small; its SA has
                   └──────────────────┘   roles/compute.instanceAdmin.v1)
```

- **3 regional spot MIGs**, one per machine size, each a distinct `node_class`
  in `node_pool=compute`. `targetSize` is owned by the Nomad Autoscaler
  (`ignoreChanges`); Pulumi only seeds the initial (== `min`) size.
- **Autoscaler VM** (always-on, ~e2-small): runs `nomad-autoscaler` against
  aither's HTTP API, one `gce-mig` policy per MIG. GCP MIG credentials come
  from the VM's own service account — no key files. Reaches aither over
  Tailscale; the MIGs reach aither + MinIO via Cloud NAT egress.
- MIG instances run the **same client config as the on-prem compute nodes**
  (`nomad02-client.hcl`): `host_volume "nf-work"`, docker `image_pull_timeout=30m`,
  drivers, ACL on. So pipeline workers place on them with no run-side change.
- **Dedicated scratch data disk:** each instance attaches a blank `dataDiskGb`
  (default **300 GB**) pd-balanced disk (deviceName `nfdata`), formatted + mounted
  at `/data` by cloud-init; the `nf-work` and `scratch` host_volumes are
  bind-mounted onto it. The 50 GB boot disk would otherwise be exhausted by
  concurrent bioinformatics worker scratch (BAMs, sorted intermediates).
  **Note:** Nomad `ephemeral_disk` does *not* bound worker scratch — it's host
  disk via the host_volume, not alloc disk. nf-nomad ignores the Nextflow `disk`
  directive entirely (sets only cpu/memory), so workers always get the 300 MB
  default alloc reservation and write data to this volume. See abc-universe
  `brainstorms/abc-seedling-prod/2026-06-05-nextflow-ephemeral-disk-analysis.md`.

## Fleet (default — `Pulumi.seedling-prod.yaml`)

| node_class       | machine            | vCPU/RAM | min | max |
|------------------|--------------------|----------|-----|-----|
| gcp-spot-8c16g   | e2-custom-8-16384  | 8 / 16G  | 1   | 2   |
| gcp-spot-16c32g  | e2-custom-16-32768 | 16 / 32G | 0   | 2   |
| gcp-spot-32c64g  | e2-custom-32-65536 | 32 / 64G | 0   | 1   |

**Scale-from-zero note:** the autoscaler scales each MIG on its `node_class`
memory-utilisation (`percentage-allocated_memory`, target 70%). Utilisation
cannot lift a pool from **0** (no nodes → no signal), so the smallest pool runs
`min=1` (one warm node) to guarantee a scale-up signal. The `min=0` pools
(16c/32c) auto-scale 1→max once seeded but do **not** auto-lift from 0 on this
signal alone — bump their `min`, or add a pending/blocked-eval APM source
(seedling VictoriaMetrics) to make them true scale-from-zero. Spot reclamation
of any node triggers Nomad to reschedule its allocations (nf-nomad re-runs the
affected tasks) — the reallocation path.

## Ephemeral node lifecycle (joining + untracking)

Spot nodes join with credentials that auto-clean when they leave, so reclaimed
nodes don't accumulate as stale entries:

- **Tailscale ephemeral key.** MIG nodes use an *ephemeral + pre-authorized +
  reusable* key, so Tailscale auto-removes the device shortly after it goes
  offline (reclaimed). The key is **minted in-stack** via `@pulumi/tailscale`
  when a Tailscale API/OAuth credential is present in the deploy environment
  (`TAILSCALE_API_KEY` + `TAILSCALE_TAILNET`, or `TAILSCALE_OAUTH_CLIENT_ID/SECRET`
  + `TAILSCALE_TAILNET` — the same path the `gcp-infra` stack uses). Without that
  cred, set `spot-compute:tailscaleKeyEphemeral` (or `tailscaleKey`) to a key you
  created as **ephemeral + reusable + pre-authorized** (`tag:nomad`). The always-on
  autoscaler VM stays on the persistent `tailscaleKey`. Minted keys are valid 90d
  → re-run `pulumi up` before expiry or new instances can't join.
- **Nomad `leave_on_interrupt`/`leave_on_terminate`.** On spot reclamation the
  client deregisters from aither instead of lingering as a `down` node until GC.

## Deploy

```bash
pulumi stack select seedling-prod
# Mint the ephemeral node key in-stack (recommended): export a Tailscale cred
export TAILSCALE_API_KEY=tskey-api-XXXX           # or TAILSCALE_OAUTH_CLIENT_ID/SECRET
export TAILSCALE_TAILNET=<your-tailnet>
# Secrets (required):
pulumi config set --secret spot-compute:tailscaleKey tskey-auth-XXXX   # persistent, autoscaler VM; reusable, tag:nomad
pulumi config set --secret spot-compute:nomadToken   <aither Nomad ACL token: read + node:read>
# Optional: if NOT minting in-stack, supply an ephemeral key for the MIG nodes:
# pulumi config set --secret spot-compute:tailscaleKeyEphemeral tskey-auth-EPHEMERAL
pulumi up
```

After `up`: `nomad node status` on aither should show one `gcp-spot-8c16g-*`
node `ready`/`eligible` in `node_pool=compute` within ~10–12 min (first boot).
Submit a pipeline → workers spread to it; stop the instance (or wait for spot
reclaim) → confirm Nomad reschedules its allocations.

## Target a different prod env

Create another stack and set `prodServerJoin` / `aitherNomadAddr` / `datacenter`
/ `nfWorkPath` for that cluster.
