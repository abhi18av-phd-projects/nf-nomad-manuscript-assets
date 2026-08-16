#!/usr/bin/env python3
"""Publication figure for the X3 preemption experiment.

Reads the two trial manifests and draws the two-layer result: Nomad's
allocation-level recovery time (panel A), and whether the pipeline itself
survived under each Nextflow error-handling configuration (panel B).

Every value is read from the TSVs; nothing is hard-coded except the panel-B
outcomes, which are recorded in the X3 README and cited there.

    python3 validation/scripts/plot_preemption.py \
        --results validation/results/X3-preemption \
        --out writeup/figures/fig-09-preemption-recovery

Writes .png (400 dpi) and .pdf next to --out.
"""

import argparse
import csv
import pathlib
import statistics

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

# Categorical slots 1-3 of the validated palette. Checked with the dataviz
# validator against a white surface: lightness band, chroma floor, CVD
# separation (worst adjacent deutan dE 9.2) and normal-vision floor all pass.
# Aqua sits at 2.82:1 contrast, which is why every point is also directly
# labelled and the groups carry their own text.
PROCESS_COLOUR = {
    "FASTQC": "#2a78d6",
    "TBBWA": "#eb6834",
    "TBREFINE": "#1baf7a",
}
GOOD, BAD = "#0ca30c", "#d03b3b"
INK, MUTED, GRID = "#1a1a19", "#5c5c58", "#dcdcd8"


def read_trials(path, run_mode):
    rows = []
    with open(path) as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if not r.get("delta_s"):
                continue
            # job names look like nf-<hash>-<hash>-MTBSEQ_NF_<STAGE>_<PROCESS>
            proc = next((p for p in PROCESS_COLOUR if r["job"].endswith(p)), "other")
            rows.append(
                {
                    "trial": int(r["trial"]),
                    "process": proc,
                    "seconds": float(r["delta_s"]),
                    "run_mode": run_mode,
                }
            )
    return rows


def panel_a(ax, rows):
    groups = [
        (1.0, "Default\nerror handling", [r for r in rows if r["run_mode"] == "default"]),
        (0.0, "errorStrategy\n= 'retry'", [r for r in rows if r["run_mode"] == "retry"]),
    ]
    allv = [r["seconds"] for r in rows]
    median = statistics.median(allv)

    ax.axvline(median, color=MUTED, lw=1, ls=(0, (4, 3)), zorder=1)
    ax.text(median + 0.5, 1.60, f"median {median:.1f} s", color=MUTED, fontsize=7.5,
            ha="left", va="bottom")

    ticks, labels = [], []
    for base, label, grp in groups:
        grp = sorted(grp, key=lambda d: d["seconds"])
        n = len(grp)
        for i, r in enumerate(grp):
            # spread within the band so markers and their labels never collide
            dy = (i - (n - 1) / 2) * 0.115
            ax.plot(r["seconds"], base + dy, "o", ms=7,
                    color=PROCESS_COLOUR[r["process"]], mec="white", mew=1.4, zorder=3)
            ax.text(r["seconds"] + 0.55, base + dy, f"{r['seconds']:.1f}", fontsize=6.5,
                    color=MUTED, ha="left", va="center")
        ticks.append(base)
        labels.append(f"{label}\n(n = {n})")

    ax.set_xlim(0, 25)
    ax.set_ylim(-0.55, 1.75)
    ax.set_yticks(ticks)
    ax.set_yticklabels(labels, fontsize=7.5, color=INK)
    ax.set_xlabel("Time from allocation kill to replacement running (s)", fontsize=8)
    ax.tick_params(axis="x", labelsize=7.5, colors=MUTED, length=3)
    ax.tick_params(axis="y", length=0)
    ax.xaxis.label.set_color(INK)
    ax.grid(axis="x", color=GRID, lw=0.6, zorder=0)
    ax.set_axisbelow(True)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(GRID)

    ax.set_title("A   Allocation recovery", fontsize=9, color=INK, loc="left", pad=12)

    handles = [Line2D([], [], marker="o", ls="", ms=6, mec="white", mew=1.0,
                      color=c, label=p) for p, c in PROCESS_COLOUR.items()]
    ax.legend(handles=handles, fontsize=7, frameon=False, ncol=3, loc="lower center",
              bbox_to_anchor=(0.5, -0.46), handletextpad=0.3, columnspacing=1.4,
              labelcolor=INK)


def panel_b(ax):
    # Outcomes recorded in validation/results/X3-preemption/README.md.
    rows = ["Default error handling", "errorStrategy = 'retry'"]
    cols = ["Nomad replaces\nthe allocation", "Pipeline continues\nto completion"]
    outcome = [[True, False], [True, True]]

    ax.set_xlim(0, 2)
    ax.set_ylim(0, 2)
    for i, r in enumerate(rows):
        for j in range(2):
            ok = outcome[i][j]
            cx, cy = j + 0.5, 1.5 - i
            ax.plot(cx, cy + 0.10, "o", ms=9, color=GOOD if ok else BAD,
                    mec="white", mew=1.2, zorder=3)
            ax.text(cx, cy - 0.12, "yes" if ok else "no", fontsize=8,
                    color=INK, ha="center", va="center")
        ax.text(-0.06, 1.5 - i, r, fontsize=7.5, color=INK, ha="right", va="center")
    for j, c in enumerate(cols):
        ax.text(j + 0.5, 2.06, c, fontsize=7.5, color=INK, ha="center", va="bottom")

    ax.axhline(1.0, color=GRID, lw=0.8)
    ax.axvline(1.0, color=GRID, lw=0.8)
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_title("B   Two layers of resilience", fontsize=9, color=INK,
                 loc="left", pad=30)
    ax.text(
        1.0, -0.34,
        "Allocation recovery is Nomad's; pipeline survival is\n"
        "Nextflow's. Recovering the allocation does not,\n"
        "by itself, save the run.",
        fontsize=7, color=MUTED, ha="center", va="top",
    )


def _flatten(path, dpi=400):
    """Composite onto opaque white and stamp DPI.

    savefig writes an alpha channel even with facecolor set, and a transparent
    PNG renders against whatever the viewer's page colour happens to be, which
    is what makes these look washed out in a PDF or Word.
    """
    from PIL import Image
    im = Image.open(path)
    if im.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    im.save(path, dpi=(dpi, dpi))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    res = pathlib.Path(a.results)
    rows = read_trials(res / "S4-preemption-noretry.tsv", "default")
    rows += read_trials(res / "S4-preemption-retry.tsv", "retry")
    if not rows:
        raise SystemExit("no trials with a recorded delta_s")

    vals = [r["seconds"] for r in rows]
    print(
        "n=%d  median=%.2f  mean=%.2f  range=%.2f-%.2f"
        % (len(vals), statistics.median(vals), statistics.mean(vals), min(vals), max(vals))
    )

    plt.rcParams["font.family"] = ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"]
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.2, 3.3), gridspec_kw={"width_ratios": [1.5, 1.0], "wspace": 0.55}
    )
    fig.patch.set_facecolor("white")
    panel_a(ax1, rows)
    panel_b(ax2)
    fig.subplots_adjust(left=0.115, right=0.965, top=0.84, bottom=0.26)

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    for ext, kw in ((".png", {"dpi": 400}), (".pdf", {})):
        fig.savefig(out.with_suffix(ext), facecolor="white", transparent=False, **kw)
        if ext == ".png":
            _flatten(out.with_suffix(ext))
        print("wrote", out.with_suffix(ext))


if __name__ == "__main__":
    main()
