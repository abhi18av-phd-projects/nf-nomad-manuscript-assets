#!/usr/bin/env python3
"""Publication figure for the E1 paired timed run.

Panel A is total walltime per arm. Panel B is the per-task placement latency
distribution, defined exactly as trace_metrics.py defines it, `start - submit`
from the Nextflow execution trace.

The point of panel B is the cost, not a win: dispatch through Nomad is slower
per task by roughly two orders of magnitude, and panel A is what shows that it
does not follow through to the wall clock at this task granularity.

    python3 validation/scripts/plot_runtime.py \
        --results validation/results/E1-executor-neutrality \
        --out writeup/figures/fig-08-runtime-panels
"""

import argparse
import csv
import datetime as dt
import pathlib
import statistics

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ARM_COLOUR = {"Local executor": "#2a78d6", "nf-nomad": "#eb6834"}
INK, MUTED, GRID = "#1a1a19", "#5c5c58", "#dcdcd8"


def _ts(v):
    v = (v or "").strip()
    if not v or v == "-":
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return dt.datetime.strptime(v, fmt)
        except ValueError:
            pass
    return None


def analyse(path):
    """Placement latency and span, matching trace_metrics.py."""
    lat, submits, completes = [], [], []
    with open(path) as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            sub, sta, comp = (_ts(r.get(k)) for k in ("submit", "start", "complete"))
            if sub and sta:
                lat.append((sta - sub).total_seconds())
            if sub:
                submits.append(sub)
            if comp:
                completes.append(comp)
    span = (max(completes) - min(submits)).total_seconds() if submits and completes else None
    return {"latency": lat, "span": span, "tasks": len(lat)}


def panel_a(ax, arms):
    names = list(arms)
    vals = [arms[n]["span"] / 60.0 for n in names]
    ypos = [1, 0]
    for y, n, v in zip(ypos, names, vals):
        ax.barh(y, v, height=0.42, color=ARM_COLOUR[n], zorder=3)
        ax.text(v + 1.2, y, f"{v:.0f} min", fontsize=8, color=INK, va="center")
    ax.set_yticks(ypos)
    ax.set_yticklabels(names, fontsize=8, color=INK)
    ax.set_xlim(0, max(vals) * 1.22)
    ax.set_ylim(-0.55, 1.55)
    ax.set_xlabel("Total walltime (min)", fontsize=8, color=INK)
    ax.tick_params(axis="x", labelsize=7.5, colors=MUTED, length=3)
    ax.tick_params(axis="y", length=0)
    ax.grid(axis="x", color=GRID, lw=0.6, zorder=0)
    ax.set_axisbelow(True)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.set_title("A   Total walltime", fontsize=9, color=INK, loc="left", pad=12)
    ax.text(
        0.0, -0.42,
        f"Same pipeline, same node, same data, {arms[names[0]]['tasks']} tasks per arm.",
        transform=ax.transAxes, fontsize=7, color=MUTED, ha="left", va="top",
    )


def panel_b(ax, arms):
    names = list(arms)
    ypos = [1, 0]
    for y, n in zip(ypos, names):
        vals = sorted(arms[n]["latency"])
        med = statistics.median(vals)
        # every task drawn; spread vertically so the mass is visible
        for i, v in enumerate(vals):
            dy = ((i % 7) - 3) * 0.035
            ax.plot(v, y + dy, "o", ms=4.2, color=ARM_COLOUR[n], mec="white",
                    mew=0.6, alpha=0.9, zorder=3)
        ax.plot([med, med], [y - 0.30, y + 0.30], color=INK, lw=1.4, zorder=4)
        ax.text(med, y + 0.34, f"median {med:.2f} s", fontsize=7, color=INK,
                ha="center", va="bottom")
    ax.set_xscale("log")
    ax.set_yticks(ypos)
    ax.set_yticklabels(names, fontsize=8, color=INK)
    ax.set_ylim(-0.62, 1.62)
    ax.set_xlabel("Placement latency, start minus submit (s, log)",
                  fontsize=8, color=INK)
    ax.tick_params(axis="x", labelsize=7.5, colors=MUTED, length=3)
    ax.tick_params(axis="y", length=0)
    ax.grid(axis="x", color=GRID, lw=0.6, zorder=0, which="major")
    ax.set_axisbelow(True)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.set_title("B   Placement latency", fontsize=9, color=INK, loc="left", pad=12)
    ax.text(
        0.0, -0.42,
        "Dispatch costs seconds per task, not milliseconds.\n"
        "Panel A is why that does not reach the wall clock.",
        transform=ax.transAxes, fontsize=7, color=MUTED, ha="left", va="top",
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

    arms = {
        "Local executor": analyse(res / "armA" / "execution_trace-armA.txt"),
        "nf-nomad": analyse(res / "armB" / "execution_trace-armB.txt"),
    }
    for n, d in arms.items():
        lat = d["latency"]
        print("%-16s tasks=%d span=%.0fs lat p50=%.3f p95=%.3f max=%.3f"
              % (n, d["tasks"], d["span"], statistics.median(lat),
                 sorted(lat)[int(0.95 * (len(lat) - 1))], max(lat)))

    plt.rcParams["font.family"] = ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.2, 2.9),
                                   gridspec_kw={"wspace": 0.38})
    fig.patch.set_facecolor("white")
    panel_a(ax1, arms)
    panel_b(ax2, arms)
    fig.subplots_adjust(left=0.115, right=0.94, top=0.85, bottom=0.30)

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    for ext, kw in ((".png", {"dpi": 400}), (".pdf", {})):
        fig.savefig(out.with_suffix(ext), facecolor="white", transparent=False, **kw)
        if ext == ".png":
            _flatten(out.with_suffix(ext))
        print("wrote", out.with_suffix(ext))


if __name__ == "__main__":
    main()
