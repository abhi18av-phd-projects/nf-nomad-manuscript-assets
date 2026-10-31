#!/usr/bin/env python3
"""preemption_trial.py — E3: measure how fast the executor recovers a preempted task.

Measures, per trial, the interval between a running task allocation being killed
and a replacement allocation for that same task reaching `running`:

    delta = t(replacement running) - t(kill issued)

and reports the median over N trials, plus whether the pipeline
completed without human intervention.

WHY THIS EXISTS RATHER THAN THE GENERIC CHAOS HARNESS
-----------------------------------------------------
The upstream chaos configs (`chaos_node.yml`, `chaos_job.yml`) were written for a
dedicated lab and are unsafe to point at a shared or production cluster:

  * `chaos_node.yml` DRAINS NODES. A drain evicts *every* allocation on the node,
    including unrelated platform services. Its skiplist names specific lab nodes
    and will not protect yours.
  * `chaos_job.yml` selects victims by namespace allow/deny lists. If the
    executor's task jobs share a namespace with anything else, the blast radius
    is everything in that namespace.

This tool instead selects victims by **exact job-name prefix of one pipeline
run**, kills **one allocation at a time**, and never touches nodes. It refuses to
run unless the prefix is given, and it prints every victim before acting.

Safety rails (all enforced, not advisory):
  * `--job-prefix` is REQUIRED; only jobs whose name starts with it are eligible.
  * A hard denylist of substrings (`--deny`, default covers common platform
    service names) is applied on top; a match aborts the trial.
  * `--dry-run` (default ON) prints what *would* be killed and exits.
  * Never drains, cordons, or otherwise modifies nodes.

Usage:
    # see what would be targeted — safe, changes nothing
    ./preemption_trial.py --job-prefix nf-abc123 --trials 10

    # actually run
    ./preemption_trial.py --job-prefix nf-abc123 --trials 10 --execute \\
        --out E3-preemption.tsv

Environment: NOMAD_ADDR, NOMAD_TOKEN, NOMAD_NAMESPACE (standard Nomad vars).
"""
import argparse
import csv
import json
import os
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DEFAULT_DENY = [
    "minio", "auth", "pocketbase", "tusd", "grafana", "victoria", "traefik",
    "caddy", "proxy", "vault", "consul", "postgres", "mysql", "redis", "app-",
]


def _req(path, method="GET", body=None):
    addr = os.environ.get("NOMAD_ADDR", "http://127.0.0.1:4646").rstrip("/")
    ns = os.environ.get("NOMAD_NAMESPACE", "default")
    sep = "&" if "?" in path else "?"
    url = f"{addr}{path}{sep}namespace={urllib.parse.quote(ns)}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    tok = os.environ.get("NOMAD_TOKEN")
    if tok:
        r.add_header("X-Nomad-Token", tok)
    if data:
        r.add_header("Content-Type", "application/json")
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(r, timeout=30, context=ctx) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def now():
    return datetime.now(timezone.utc)


def running_allocs(prefix, deny):
    """Running allocations whose JOB name starts with prefix and hits no denylist term."""
    out = []
    for job in _req("/v1/jobs"):
        name = job.get("ID") or job.get("Name") or ""
        if not name.startswith(prefix):
            continue
        low = name.lower()
        hit = next((d for d in deny if d in low), None)
        if hit:
            sys.exit(f"ABORT: job {name!r} matches denylist term {hit!r} — refusing to touch it.")
        for a in _req(f"/v1/job/{urllib.parse.quote(name)}/allocations"):
            if a.get("ClientStatus") == "running":
                out.append({"job": name, "alloc": a["ID"], "node": a.get("NodeName") or a.get("NodeID", "")[:8]})
    return out


def wait_replacement(job, killed_alloc, timeout_s):
    """Wait until some allocation for `job` other than killed_alloc is running."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        for a in _req(f"/v1/job/{urllib.parse.quote(job)}/allocations"):
            if a["ID"] != killed_alloc and a.get("ClientStatus") == "running":
                return now(), a["ID"]
        time.sleep(1)
    return None, None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--job-prefix", required=True,
                    help="REQUIRED. Only jobs whose name starts with this are eligible victims.")
    ap.add_argument("--trials", type=int, default=10)
    ap.add_argument("--timeout", type=int, default=600, help="seconds to wait for a replacement")
    ap.add_argument("--settle", type=int, default=20, help="seconds between trials")
    ap.add_argument("--deny", nargs="*", default=DEFAULT_DENY,
                    help="substrings that abort the run if seen in a candidate job name")
    ap.add_argument("--execute", action="store_true", help="actually kill (default is dry-run)")
    ap.add_argument("--out", help="write per-trial TSV here")
    args = ap.parse_args()

    if not args.execute:
        cands = running_allocs(args.job_prefix, args.deny)
        print(f"DRY RUN — {len(cands)} candidate allocation(s) match prefix {args.job_prefix!r}:")
        for c in cands[:20]:
            print(f"  {c['alloc'][:8]}  {c['job']}  node={c['node']}")
        print("\nNothing was modified. Re-run with --execute to perform the trials.")
        return

    rows = []
    for t in range(1, args.trials + 1):
        cands = running_allocs(args.job_prefix, args.deny)
        if not cands:
            print(f"trial {t}: no running allocation to preempt — waiting…")
            time.sleep(args.settle)
            continue
        v = cands[0]
        t0 = now()
        print(f"trial {t}: killing {v['alloc'][:8]} ({v['job']}) on {v['node']} at {t0.isoformat()}")
        _req(f"/v1/allocation/{v['alloc']}/stop", method="POST")
        t1, newalloc = wait_replacement(v["job"], v["alloc"], args.timeout)
        if t1 is None:
            print(f"  no replacement within {args.timeout}s — recorded as timeout")
            rows.append({"trial": t, "job": v["job"], "killed_alloc": v["alloc"],
                         "kill_ts": t0.isoformat(), "recovered_ts": "", "delta_s": ""})
        else:
            d = (t1 - t0).total_seconds()
            print(f"  recovered as {newalloc[:8]} after {d:.2f}s")
            rows.append({"trial": t, "job": v["job"], "killed_alloc": v["alloc"],
                         "kill_ts": t0.isoformat(), "recovered_ts": t1.isoformat(),
                         "delta_s": f"{d:.2f}"})
        time.sleep(args.settle)

    deltas = [float(r["delta_s"]) for r in rows if r["delta_s"]]
    print("\n=== E3 preemption recovery ===")
    print(f"trials: {len(rows)}   recovered: {len(deltas)}   timed out: {len(rows)-len(deltas)}")
    if deltas:
        print(f"median: {statistics.median(deltas):.2f}s   min: {min(deltas):.2f}s   max: {max(deltas):.2f}s")
    if args.out and rows:
        with open(args.out, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), delimiter="\t")
            w.writeheader()
            w.writerows(rows)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
