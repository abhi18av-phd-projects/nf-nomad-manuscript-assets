# Conceptual figures — design brief

**For:** a designer working on the nf-nomad manuscript (OUP *Bioinformatics* Application Note).
**Date:** 2026-08-06. **Status:** brief only, nothing drawn yet.

This document specifies figures that need a designer rather than a diagram-as-code tool. It is
self-contained: a designer should not need the manuscript to work from it, though quoted claims
are marked so they can be checked against the text.

---

## What already exists, and why it is not enough

Two figures are drawn in mermaid and render in the compiled manuscript.

| Existing | Carries | Why it stays as-is |
|---|---|---|
| **Figure 1** — system architecture, control plane over execution plane, with the three work-directory modes hanging off a service interface | the mechanism | Structural, boxes-and-arrows, no visual argument. Mermaid is the right tool. |
| **Figure 2** — the two validation experiments, E1 (substrate neutrality) and E2 (mode equivalence) | the experimental design | Same. It is a flowchart and reads as one. |

What neither carries is the **motivation**. The manuscript's opening argument — that capacity
building has narrowed the skills gap while the infrastructure gap remains — is currently prose
plus a single citation. It is the claim a reader must accept before the rest of the paper matters,
and it is the one part of the paper that would benefit most from being seen rather than read.

Constraint worth stating up front: an Application Note has a hard figure budget. **Realistically
one of the figures below makes it into the paper**; the others are for the supplementary material,
the preprint, or talks. Design accordingly — F1 is the one to invest in.

---

## F1 — The gap that motivates the work ★ *highest value*

**The claim it carries.** Analytical demand and analytical capacity are unevenly distributed, and
the binding constraint is no longer trained people but the compute substrate they have access to.

**Why it needs a designer.** This is a two-variable relationship with a divergence in the middle.
A bar chart states it; a well-composed figure makes the divergence the thing you see first. That
is a compositional problem, not a plotting problem.

**Content.** Three quantities, one frame:

1. Share of the world's deposited sequence data originating from African research settings — small.
2. Share of the global infectious-disease burden carried by those same settings — large.
3. Bioinformatics training capacity built over the last decade (H3ABioNet and its successors) —
   rising.

The reading should be: (1) and (2) diverge, (3) rises without closing the divergence. The
conclusion the reader should reach unaided is that training was necessary and was not sufficient.

**Sources.** Mboowa et al. 2022 for the data/burden asymmetry; Mulder et al. 2016 for the
H3ABioNet capacity-building programme. **Exact numbers must be pulled from those papers before
drawing** — do not scale anything by eye. If a number is not in a citable source it does not go
in the figure.

**Style.** Restrained. This figure is making an argument about under-resourcing and must not look
like an infographic about it. No icons of continents, no human silhouettes, no red alarm palette.
Print greyscale-safe, single-column width (≈85 mm), legible at that size without zoom.

**Risk to avoid.** Anything implying a deficit narrative about African research. The figure's
subject is *infrastructure distribution*, not capability. Caption and labels should say so
explicitly.

---

## F2 — Where the reproducibility problem is solved, and where it is not

**The claim it carries.** Workflow engines, container ecosystems and curated pipeline collections
resolve reproducibility at the *pipeline-author* layer. None of them resolves the
*infrastructure-deployment* layer beneath, which an institution must cross before a single
pipeline runs.

**Why it needs a designer.** The point is that one layer is well populated and the other is
sparse. That asymmetry has to be visible at a glance, which is a matter of visual weight and
negative space rather than of correct boxes.

**Content.** A stack, upper layer dense and lower layer thin:

- *Pipeline-author layer (solved, crowded):* Nextflow, Snakemake, Bioconda, BioContainers,
  nf-core, Docker, Singularity, Podman.
- *Infrastructure-deployment layer (the gap):* acquisition, configuration, scheduling across
  heterogeneous hardware, ongoing operation — no dedicated platform team.
- *Where nf-nomad sits:* spanning the boundary. It is an executor, so it is the piece that lets
  the crowded upper layer land on whatever the lower layer actually is.

**Style.** The named tools are real projects. Use plain text labels, no logos — logo use invites
trademark questions and dates the figure.

**Caption must not overclaim.** nf-nomad addresses the scheduling and execution part of the lower
layer. It does not provision hardware or replace an operations function, and the figure must not
suggest it does.

---

## F3 — One pipeline, three work-directory modes *(supplementary or talk)*

**The claim it carries.** The pipeline definition is unchanged across all three modes; only the
deployment configuration differs. That is the practical payoff of putting the modes behind a
service interface.

**Content.** One pipeline source on the left. Three paths to the right — shared POSIX filesystem,
Fusion with Wave, `nf-nomad-s5cmd` with an S3 store — converging on one identical set of outputs.
The visual emphasis belongs on *identical input, identical output, three different middles*.

**Do not draw a decision tree.** An earlier sketch went that way and it is misleading: mode choice
is an operator decision made once per deployment, not a per-run branch.

**Overlap warning.** This restates part of Figure 1. It earns its place only if drawn as a
*symmetry* figure rather than another architecture diagram. If it comes out looking like Figure 1,
drop it.

---

## F4 — Preemption and recovery, one trial *(blocked on data)*

**The claim it carries.** When a node holding running work disappears, the scheduler places that
work elsewhere and the pipeline completes unattended.

**Content.** A timeline of a single trial: node stopped, allocations displaced, evaluation,
placement on surviving nodes, job back at desired count. Annotated with the measured interval.

**Blocked.** The manuscript's preemption number is not yet verified. The local cluster has
produced 4 trials with a median of 26 s; the campaign calls for 10, and the figure should be drawn
from the final distribution, not from the interim median. **Do not draw this until the trial data
exists.** Numbers drawn before measurement have a way of surviving into print.

When it is unblocked, the honest form is a distribution across trials rather than a single
timeline. A single-trial timeline invites the reader to treat one observation as the result.

---

## Applies to all figures

- **Single-column width by default** (≈85 mm). Anything needing double column must justify it.
- **Greyscale-safe.** Print copies exist and reviewers use them. Never encode meaning in hue
  alone; use position, weight or texture as well.
- **Vector source** (SVG or PDF), plus a 600 dpi raster. Editable source files belong in this
  repository so the figure can be revised at proof stage.
- **Colour-vision safe palette** — the manuscript's existing mermaid figures use blue / amber /
  green, which is already deuteranopia-safe. Keep to it so the figure set reads as one set.
- **No number appears in a figure unless it appears in the text with a citation or a measurement
  behind it.** This is the one hard rule.
- **Captions are self-contained.** A reader who reads only the figures should get the argument.
  Existing captions in the manuscript are written to that standard; match their register — plain,
  declarative, no exclamation.

---

## Suggested order

1. **F1** — the motivating gap. Highest value, and the only one likely to make the paper itself.
2. **F2** — the layer argument. Second-highest, and useful in talks regardless of the paper.
3. **F3** — only if it can be drawn as symmetry rather than architecture.
4. **F4** — after the trial data exists, not before.
