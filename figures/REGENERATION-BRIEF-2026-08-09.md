# Figure regeneration brief — 2026-08-09

**For:** Claude Code, regenerating the nf-nomad manuscript figure pack.
**Previous pack:** `fig-01` … `fig-09` PNGs at 4× (≈3120 px wide), generated from a single
source-of-truth HTML figure kit. Keep that approach — one HTML file, pure inline-styled
HTML (no canvas, no bitmaps), re-exported to PNG at 4× and to SVG via `<foreignObject>`.

Three things changed since that pack: the **deployment templates**, the **positioning
argument**, and the **availability of real measurements**. Figures 6, 7 and 8 need
redrawing; 3 and 9 need factual correction; 4 and 5 need only a check.

---

## 0. Do not change the design system

Carry these forward exactly — the pack must stay visually consistent.

| Token | Value |
|---|---|
| paper | `#FAF3E7` |
| inset | `#F1E6D3` |
| ink | `#2B241D` |
| secondary ink | `#6B5D4F` |
| hairline | `#DCCEB6` |
| strong stroke | `#3A2E22` |
| highlight — deep green | `#3E6259` fill `#DCE7E1` |
| highlight — olive | `#5C7A4A` fill `#E4EAD8` |
| eyebrow accent (terracotta) | `#C1553B` — small eyebrow labels only |

Type: **IBM Plex Sans** (labels, captions) + **JetBrains Mono** (tags, notes, numbers).
Figure width 780 px ≈ 190 mm double-column. Keep the `Fig N` black chip top-left, the
terracotta eyebrow (`SUPPLEMENTARY S1 · FIG-LOCAL-TEMPLATE`), the grey right-hand
column/width note, the hairline rule under the title, and the bold `Figure N.` caption
paragraph below the frame.

**One palette change.** In the old pack deep green carried *"executor, Fusion, OCI, E1"*.
OCI is no longer a described deployment, so green now means **the plugin's own paths**
(executor, Fusion, E1) and olive means **s5cmd, spot/preemptible, E2**. Do not colour any
cloud provider by brand.

---

## 1. What changed, and why the figures must follow

### 1.1 The local template is Docker, not Multipass
The Multipass + Pulumi template did not actually provision a cluster, and the working
version lived in a private repository a reviewer could not reach. It is replaced by a
**Docker Compose** cluster: a Nomad server container, N Nomad client containers and a
MinIO container, on one machine. No hypervisor, no VM images, no cloud account; identical
on macOS, Linux and Windows. This is now the canonical reviewer artefact and the
project's own development environment. All three e2e pipelines (`nextflow-io/hello`,
`nextflow-io/rnaseq-nf`, `nf-core/demo`) were run on it successfully.

### 1.2 The cloud template is GCP-only and standalone
The old template combined OCI persistent nodes with a GCP spot fleet, and — importantly —
was wired to join an existing institutional cluster rather than stand up its own. It is
now a **standalone GCP** deployment: a persistent Nomad server instance plus a preemptible
spot fleet joined over an overlay network, bootstrapping its own Raft.

**The OCI template has since been dropped from the artefact repository.** Do not draw a
figure for it, and do not reference it in any caption.

### 1.3 The positioning argument is now evidence-backed
A survey of the official Nextflow plugin registry (2026-08-09) supports what was
previously asserted qualitatively. Use these numbers; do not invent others.

| Quantity | Value |
|---|---|
| Plugins in the registry | 92 |
| Executor plugins | 25 (27 %) |
| Top-3 share of executor downloads | 93.3 % |
| nf-nomad rank | **6th of 25 executors** |

The two load-bearing qualitative points: traditional HPC schedulers (SLURM, PBS, LSF, SGE,
HTCondor) are **absent from the registry by construction** because they ship inside
Nextflow itself; and among the 25 executor targets, **only Kubernetes and Nomad are
general-purpose orchestrators an institution can host itself** — everything else is a
managed cloud batch service or a site-specific scheduler variant.

---

## 2. Per-figure instructions

### Fig 6 — REDRAW → `fig-06-local-docker-template.png`
*Slot: Supplementary S1, `@fig-local-template`. 1-col ≈ 90 mm.*

Replace VMs with containers. Keep the old figure's structure (outer dashed host frame,
server box on top, two client boxes below, two work-dir options at the bottom) — it
worked; only the substance changes.

- Outer dashed frame eyebrow: `SINGLE MACHINE · DOCKER COMPOSE · NO CLOUD ACCOUNT`
  (drop "≥16 GB RAM · PULUMI + MULTIPASS")
- Top box: `CONTAINER · SERVER` / **Nomad server** / `HTTP API :4646 · ACL bootstrap`
- Two boxes: `CONTAINER · CLIENT 1` … `CLIENT N` / **Nomad client** / `Docker driver`
- Add a third peer container box: `CONTAINER · MINIO` / **MinIO** / `S3 endpoint :9000`
- Bottom two dashed options, unchanged in role:
  - **Host-mounted work dir** / `shared POSIX workdir`
  - **MinIO S3 endpoint** / `object-store workdir (:9000)`
- Title: **Local Docker deployment template**

Caption: *A Docker Compose project brings up a Nomad server, N Nomad clients and a MinIO
S3 endpoint as containers on a single machine. No hypervisor, virtual-machine images or
cloud credentials are required, and the same definition runs on macOS, Linux and Windows.
Clients either share a host-mounted work directory or stage through S3.*

**Remove** the old caption's final sentence about qualifying cold-start timings — the
cold-start claim was cut from the manuscript.

### Fig 7 — REDRAW → `fig-07-cloud-gcp-template.png`
*Slot: Supplementary S5, `@fig-cloud-template`. 2-col ≈ 190 mm.*

Delete the entire left-hand Oracle Cloud panel. The figure becomes a single-provider
diagram; use the freed width rather than leaving a gap.

- One dashed frame, eyebrow `GOOGLE CLOUD · STANDALONE NOMAD CLUSTER`
- Inside, left: `GCP` / **Nomad server** / `control plane + S3-compatible endpoint`
  (paper/inset fill — it is persistent, not spot)
- Inside, right: `GCP · SPOT` / **Preemptible worker fleet** / `burst capacity, live preemption`
  (olive `#5C7A4A` / `#E4EAD8`)
- Keep the full-width **Overlay network — Tailscale** bar, but change the sub-label to
  `joins server and spot workers into one Nomad cluster` ("both provider pools" is now wrong)
- Keep the **S3-compatible endpoint** bar and its `worker → S3 staging via s5cmd or Fusion
  — no shared filesystem required` sub-label
- Title: **Cloud GCP deployment template**

Caption: *A persistent Nomad server instance manages the cluster and hosts an
S3-compatible endpoint. Compute workers are preemptible spot instances joined over an
overlay network. Worker→S3 staging uses s5cmd or Fusion; no shared filesystem is required.
The cluster bootstraps its own Raft and depends on no provider-specific execution service.*


### Fig 8 — REDRAW WITH REAL DATA → `fig-08-benchmark-panels.png`
*Slot: quantitative comparator. 2-col ≈ 190 mm.*

The panels were hatched placeholders. Two of three can now be drawn from measurements.
**Draw only what the data supports and mark the rest as pending — do not interpolate.**

**Panel A — Walltime, local executor vs nf-nomad.** Paired bars, 5-sample run, same node:

| Arm | Wall-clock | Tasks |
|---|---|---|
| A — Nextflow local executor | 2,989 s (49.8 min) | 41 |
| B — nf-nomad | 2,863 s (47.7 min) | 41 |

Annotate: *single paired run; read as "no wall-clock penalty observed", not as a speed
claim.* The 90-sample pair is **not** complete — arm A finished (636 tasks, 50,131 s) but
arm B is still running. Either omit the 90-sample bars or hatch them and label
`90-sample pair pending`.

**Panel B — Per-task placement latency.** Real percentiles, same 5-sample run, n = 41 per arm:

| Arm | min | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| A — local executor | 0.009 | **0.077** | 0.091 | 0.092 | 0.092 |
| B — nf-nomad | 2.772 | **4.802** | 40.864 | 49.033 | 49.033 |

All values in seconds. A log y-axis is appropriate — the arms differ by ~60× at p50. The
honest reading: orchestration costs a median ≈4.7 s per task to place, and that cost is
absorbed by concurrency rather than accumulating into the critical path.

**Panel C — Recovery after preemption.** Nine trials with a live victim, 9/9 recovered,
0 timeouts. Plot the points with a median line:

```
no-retry:  15.63, 18.95, 11.23, 7.92
retry:     11.25, 20.08, 20.10, 14.52, 18.98
median = 15.63 s   mean = 15.41 s   range = 7.92 – 20.10 s
```

Axis label `9 independent trials` — **not 10.** The old placeholder said ten; nine had a
live victim. Do not round the median to "≈16 s"; print 15.63 s.

Retitle the eyebrow from `QUANTITATIVE COMPARATOR · NUMBERS PENDING` to
`QUANTITATIVE COMPARATOR · MEASURED 2026-08-06`.

Caption must state: pipeline (`mtbseq-nf` v1.0.0, parallel mode), sample count, that both
arms ran on the **same node**, and that panel C's workload is the same pipeline under
one-allocation-at-a-time preemption. **Do not** reinstate the "median 47 s" figure
anywhere — it did not reproduce and has been removed from the manuscript.

### Fig 3 — CORRECT → `fig-03-executor-comparison.png`
Previously qualitative, flagged as a submission risk because it made unbacked comparative
claims against SLURM and Kubernetes. It can now rest on the registry survey.

- Keep it qualitative about *operational footprint*; add the registry evidence as a
  factual sidebar: `92 plugins · 25 executors · nf-nomad 6th · top-3 = 93 % of downloads`
- State the structural point plainly: **SLURM/PBS/LSF/SGE/HTCondor ship inside Nextflow,
  so they do not appear in the registry at all** — the registry maps *newer* targets
- Highlight that only **Kubernetes and Nomad** among the 25 are self-hostable
  general-purpose orchestrators
- **Do not** assert that Nomad is simpler/faster/cheaper than Kubernetes or SLURM without
  a citation — the agent-review TODOs flag exactly this. Confine claims to component
  counts and what the registry demonstrably contains.

### Fig 9 — CHECK → `fig-09-nomad-topologies.png`
Three exercised topologies. Verify no panel is labelled OCI or Multipass. If one depicts
the OCI+GCP hybrid, replace it with the Docker single-machine topology, which is now the
one a reader can actually reproduce.

### Figs 4 and 5 — CHECK ONLY
`fig-04-architecture-three-modes` (manuscript Figure 1) and
`fig-05-validation-experiments` (Figure 2) describe the plugin and the experiment design,
neither of which changed. Confirm no incidental "Multipass"/"OCI" labels, then leave them.

### Figs 1 and 2 — no action
`fig-01` is superseded by fig-04; `fig-02` has no manuscript slot.

---

## 3. Output contract

- PNG at 4× (≈3120 px wide) into this folder, plus SVG via the exporter page
- Filenames change where the subject changed: `fig-06-local-docker-template.png`,
  `fig-07-cloud-gcp-template.png`. **Delete the superseded
  `fig-06-local-multipass-template.png` and `fig-07-cloud-oci-gcp-template.png`** rather
  than leaving both — a stale Multipass figure in the pack is how the wrong one gets
  compiled.
- Update the pack `README.md` table: filenames, slots, and status
- Fonts load from Google Fonts; for offline builds self-host IBM Plex Sans and JetBrains
  Mono and swap the `<link>` plus `FONT_IMPORT` in the exporter

## 4. Guardrails

- **Never invent a number.** Every value in Fig 8 is listed above; if a panel needs
  something not listed, hatch it and label it pending.
- **n = 9 for preemption**, not 10.
- **No "47 s"** anywhere, in any figure or caption.
- The 90-sample E1 pair is **incomplete**; do not draw it as if both arms finished.
- No provider brand colouring, and no OCI figure.
- Panel A is a **single paired run** — the caption must not imply a repeated benchmark.
