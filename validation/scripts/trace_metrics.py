#!/usr/bin/env python3
"""trace_metrics.py — derive runtime + placement-latency metrics from Nextflow traces.

This is the X4 post-processing step: Nextflow's `execution_trace.txt` already
records `submit`, `start`, `complete` per task, so **placement latency** — the
time the orchestrator took to place a task after Nextflow submitted it — is
`start - submit`. No extra instrumentation and no extra compute run is needed.

Usage:
    ./trace_metrics.py <trace.txt> [<trace.txt> ...]          # table to stdout
    ./trace_metrics.py --tsv out.tsv <trace.txt> ...          # also write a TSV

Reports, per trace: task count, statuses, wall-clock span, and the placement
latency distribution (min/p50/p95/p99/max) plus task runtime totals.

Caveat worth stating in any paper that uses these numbers: a task whose container
image is not yet cached on the target node includes the image pull inside its
placement latency. Pre-pull (or otherwise warm) images before reporting placement
latency as a property of the executor rather than of the image cache.
"""
import argparse
import csv
import statistics
import sys
from datetime import datetime

TS = "%Y-%m-%d %H:%M:%S.%f"


def _parse_ts(v):
    v = (v or "").strip()
    if not v or v == "-":
        return None
    try:
        return datetime.strptime(v, TS)
    except ValueError:
        try:
            return datetime.strptime(v, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None


def _pct(values, q):
    """Percentile without numpy: nearest-rank on the sorted sample."""
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = max(0, min(len(s) - 1, int(round((q / 100.0) * len(s) + 0.5)) - 1))
    return s[k]


def analyse(path):
    rows = []
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            rows.append(r)
    if not rows:
        return None

    lat, submits, completes, statuses = [], [], [], {}
    for r in rows:
        st = (r.get("status") or "").strip()
        statuses[st] = statuses.get(st, 0) + 1
        sub, sta, comp = (_parse_ts(r.get(k)) for k in ("submit", "start", "complete"))
        if sub and sta:
            lat.append((sta - sub).total_seconds())
        if sub:
            submits.append(sub)
        if comp:
            completes.append(comp)

    span = (max(completes) - min(submits)).total_seconds() if submits and completes else None
    return {
        "trace": path,
        "tasks": len(rows),
        "statuses": statuses,
        "span_s": span,
        "lat_n": len(lat),
        "lat_min": min(lat) if lat else None,
        "lat_p50": _pct(lat, 50),
        "lat_p95": _pct(lat, 95),
        "lat_p99": _pct(lat, 99),
        "lat_max": max(lat) if lat else None,
        "lat_mean": statistics.fmean(lat) if lat else None,
    }


def _fmt(v):
    return "-" if v is None else f"{v:.2f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("traces", nargs="+")
    ap.add_argument("--tsv", help="also write the summary as TSV to this path")
    args = ap.parse_args()

    results = [r for r in (analyse(p) for p in args.traces) if r]
    if not results:
        sys.exit("no usable trace rows found")

    hdr = f"{'trace':<44} {'tasks':>5} {'span_s':>8} {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7}"
    print(hdr)
    print("-" * len(hdr))
    for r in results:
        name = r["trace"].split("/")[-1]
        print(f"{name:<44} {r['tasks']:>5} {_fmt(r['span_s']):>8} "
              f"{_fmt(r['lat_p50']):>7} {_fmt(r['lat_p95']):>7} "
              f"{_fmt(r['lat_p99']):>7} {_fmt(r['lat_max']):>7}")
    print("\nplacement latency = start - submit, in seconds")
    for r in results:
        print(f"  {r['trace'].split('/')[-1]}: statuses={r['statuses']}")

    if args.tsv:
        cols = ["trace", "tasks", "span_s", "lat_n", "lat_min", "lat_p50",
                "lat_p95", "lat_p99", "lat_max", "lat_mean"]
        with open(args.tsv, "w", newline="") as fh:
            w = csv.writer(fh, delimiter="\t")
            w.writerow(cols)
            for r in results:
                w.writerow([r["trace"].split("/")[-1] if c == "trace" else r[c] for c in cols])
        print(f"\nwrote {args.tsv}")


if __name__ == "__main__":
    main()
