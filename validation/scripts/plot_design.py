#!/usr/bin/env python3
"""Validation design figure: the three experiments and what each isolates.

A schematic, not a data plot. Each column is one experiment, read top to
bottom: the question, what is held constant, the arms that differ, and the
criterion the comparison is judged against. The content mirrors Table 2 of the
main text exactly, so the two cannot drift.

    python3 validation/scripts/plot_design.py --out writeup/figures/fig-05-validation-design
"""

import argparse
import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

INK, MUTED, LINE = "#1a1a19", "#5c5c58", "#c9c9c4"
ACCENT = ["#2a78d6", "#eb6834", "#1baf7a"]
HELD = "#f2f2ef"

EXPERIMENTS = [
    {
        "id": "E1",
        "question": "Does the choice of executor\nchange the result?",
        "held": "MTBseq-nf, 90 sequences\nENA PRJEB7727\nsame inputs, containers, hardware",
        "arms": ["Nextflow\nlocal executor", "nf-nomad"],
        "varies": "the executor",
        "criterion": "Every result table bit-identical,\nor differing only in run-stamped\nfields, with no row differing in\ngenomic position",
    },
    {
        "id": "E2",
        "question": "Does the choice of storage\nplane alter the outputs?",
        "held": "nf-core/detaxizer 1.3.0\nsame cluster, inputs, images",
        "arms": ["Fusion\nwith Wave", "nf-nomad-s5cmd"],
        "varies": "the storage plane",
        "criterion": "Results bit-identical between\nmodes, with any difference confined\nto files carrying paths and\ntimestamps, not biological content",
    },
    {
        "id": "E3",
        "question": "Is a preempted task recovered,\nand does the run complete?",
        "held": "MTBseq-nf, 5 samples, one node\nnine preemptions in two runs",
        "arms": ["Default\nerror handling", "errorStrategy\n= 'retry'"],
        "varies": "a running task allocation, stopped",
        "arms_note": "one run under each",
        "criterion": "Every stopped allocation\nreplaced without operator\nintervention; with retry,\nthe pipeline completes",
    },
]


def box(ax, x, y, w, h, text, fc, ec, fs=6.6, weight="normal", tc=INK):
    ax.add_patch(
        FancyBboxPatch(
            (x, y), w, h, boxstyle="round,pad=0,rounding_size=0.018",
            linewidth=0.8, facecolor=fc, edgecolor=ec, zorder=2,
        )
    )
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center",
            fontsize=fs, color=tc, weight=weight, zorder=3, linespacing=1.45)


def arrow(ax, x, y0, y1):
    ax.add_patch(
        FancyArrowPatch((x, y0), (x, y1), arrowstyle="-|>", mutation_scale=7,
                        linewidth=0.8, color=LINE, zorder=1, shrinkA=0, shrinkB=0)
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    fig, ax = plt.subplots(figsize=(7.2, 4.5))
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 3)
    ax.set_ylim(0, 1)
    ax.axis("off")

    for i, e in enumerate(EXPERIMENTS):
        cx = i + 0.5
        col = ACCENT[i]
        left, w = i + 0.055, 0.89

        # identity badge + question
        ax.add_patch(FancyBboxPatch((left, 0.905), 0.10, 0.055,
                                    boxstyle="round,pad=0,rounding_size=0.02",
                                    linewidth=0, facecolor=col, zorder=3))
        ax.text(left + 0.05, 0.9325, e["id"], ha="center", va="center",
                fontsize=7, color="white", weight="bold", zorder=4)
        ax.text(left + 0.125, 0.9325, e["question"], ha="left", va="center",
                fontsize=7.6, color=INK, weight="bold", linespacing=1.4)

        # held constant
        box(ax, left, 0.685, w, 0.135, e["held"], HELD, HELD, fs=6.4, tc=MUTED)
        ax.text(left + 0.012, 0.828, "held constant", ha="left", va="bottom",
                fontsize=5.9, color=MUTED, style="italic")
        arrow(ax, cx, 0.685, 0.625)

        # what varies
        ax.text(cx, 0.598, f"varies: {e['varies']}", ha="center", va="center",
                fontsize=6.3, color=col, weight="bold")

        # the two arms
        if e.get("arms_note"):
            ax.text(cx, 0.566, e["arms_note"], ha="center", va="center",
                    fontsize=5.9, color=MUTED, style="italic")
        aw = (w - 0.045) / 2
        for j, arm in enumerate(e["arms"]):
            box(ax, left + j * (aw + 0.045), 0.415, aw, 0.135, arm,
                "white", col, fs=6.5)
            arrow(ax, left + j * (aw + 0.045) + aw / 2, 0.415, 0.352)

        # compare
        box(ax, left + 0.155, 0.262, w - 0.31, 0.088,
            "compare every output\nby SHA-256 digest" if i < 2 else
            "time to a replacement\nallocation running",
            "white", LINE, fs=6.2, tc=MUTED)
        arrow(ax, cx, 0.262, 0.202)

        # criterion
        box(ax, left, 0.045, w, 0.155, e["criterion"], "white", col, fs=6.3)
        ax.text(left + 0.012, 0.208, "agreement means", ha="left", va="bottom",
                fontsize=5.9, color=col, style="italic")

        if i < 2:
            ax.plot([i + 1.0, i + 1.0], [0.03, 0.97], color="#e8e8e4",
                    lw=0.8, zorder=0)

    fig.subplots_adjust(left=0.005, right=0.995, top=0.99, bottom=0.01)

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    for ext, kw in ((".png", {"dpi": 400}), (".pdf", {})):
        fig.savefig(out.with_suffix(ext), facecolor="white", transparent=False, **kw)
    # flatten the PNG onto opaque white; savefig keeps an alpha channel otherwise
    from PIL import Image
    p = out.with_suffix(".png")
    im = Image.open(p)
    if im.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im.convert("RGB").save(p, dpi=(400, 400))
    print("wrote", p, "and", out.with_suffix(".pdf"))


if __name__ == "__main__":
    main()
