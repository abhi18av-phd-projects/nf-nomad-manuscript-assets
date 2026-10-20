#!/usr/bin/env python3
"""output_digests.py — SHA-256 manifests for comparing pipeline outputs (X5).

Produces, for every output file, BOTH:

  * `sha256_raw`        — the file exactly as written.
  * `sha256_normalised` — the file with **volatile fields** neutralised.

Why two digests: several bioinformatics tools stamp run-specific values into
otherwise-deterministic outputs. MTBseq, for example, writes a leading `Date`
column into its `.tab` tables, so two runs of the same pipeline on the same data
produce different bytes on different days. A raw-digest mismatch would then be
read as "the substrate changed the biological answer", which is wrong. The
normalised digest answers the question the substrate-neutrality experiment (E1)
actually asks — *did the results change?* — while the raw digest is retained for
full transparency.

Normalisation is deliberately narrow and declared per rule (see `RULES`): only
recognised volatile patterns are rewritten. Anything else is a real difference.

Usage:
    ./output_digests.py <dir> --label armA --out armA.tsv
    ./output_digests.py --compare armA.tsv armB.tsv [reference.tsv ...]

`--compare` reports, per file: whether the raw digests agree, whether the
normalised digests agree, and which files are missing from which manifest.
"""
import argparse
import csv
import hashlib
import re
import sys
from pathlib import Path

# Volatile-field rules. Each entry: (description, compiled regex, replacement).
# Applied line-wise to text files only; binary files are never rewritten.
RULES = [
    ("ISO date at start of a field (e.g. MTBseq's `Date` column: '2024-09-09)",
     re.compile(rb"'?\d{4}-\d{2}-\d{2}"), b"<DATE>"),
    ("ISO timestamp",
     re.compile(rb"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?"), b"<TIMESTAMP>"),
]

TEXT_SUFFIXES = {".tab", ".txt", ".tsv", ".csv", ".matrix", ".groups", ".fasta", ".fa", ".yml", ".yaml", ".json"}


def _is_text(p: Path) -> bool:
    if p.suffix.lower() in TEXT_SUFFIXES:
        return True
    try:
        with p.open("rb") as fh:
            return b"\0" not in fh.read(4096)
    except OSError:
        return False


def digests(path: Path):
    raw = hashlib.sha256()
    norm = hashlib.sha256()
    text = _is_text(path)
    with path.open("rb") as fh:
        for line in fh:
            raw.update(line)
            if text:
                for _desc, pat, repl in RULES:
                    line = pat.sub(repl, line)
            norm.update(line)
    return raw.hexdigest(), norm.hexdigest(), text


def build(root: Path, label: str, out: Path, skip_logs: bool):
    rows = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        # Logs and Nextflow's own run metadata are inherently run-specific.
        if skip_logs and (p.suffix.lower() == ".log" or "pipeline_info" in rel):
            continue
        r, n, text = digests(p)
        rows.append({"path": rel, "bytes": p.stat().st_size,
                     "sha256_raw": r, "sha256_normalised": n,
                     "normalised": "yes" if text else "binary"})
    with out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["path", "bytes", "sha256_raw", "sha256_normalised", "normalised"],
                           delimiter="\t")
        w.writeheader()
        w.writerows(rows)
    print(f"[{label}] {len(rows)} files → {out}")
    return rows


def _load(p):
    with open(p, newline="") as fh:
        return {r["path"]: r for r in csv.DictReader(fh, delimiter="\t")}


def compare(manifests):
    loaded = [(m, _load(m)) for m in manifests]
    base_name, base = loaded[0]
    all_paths = sorted(set().union(*[set(d) for _, d in loaded]))

    same_raw = same_norm = diff_norm = missing = 0
    print(f"comparing {len(loaded)} manifests, baseline = {base_name}\n")
    for path in all_paths:
        present = [(n, d.get(path)) for n, d in loaded]
        if any(r is None for _, r in present):
            absent = [n for n, r in present if r is None]
            print(f"  MISSING   {path}  (absent from: {', '.join(absent)})")
            missing += 1
            continue
        raws = {r["sha256_raw"] for _, r in present}
        norms = {r["sha256_normalised"] for _, r in present}
        if len(raws) == 1:
            same_raw += 1
            same_norm += 1
        elif len(norms) == 1:
            same_norm += 1
            print(f"  VOLATILE  {path}  (raw differs, normalised identical — run-specific fields only)")
        else:
            diff_norm += 1
            print(f"  DIFFERENT {path}  (normalised digests differ — a REAL difference)")

    print(f"\nsummary: {same_raw} bit-identical, "
          f"{same_norm - same_raw} identical after normalisation, "
          f"{diff_norm} genuinely different, {missing} missing")
    return 1 if (diff_norm or missing) else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", nargs="?", help="directory of outputs to digest")
    ap.add_argument("--label", default="run")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--keep-logs", action="store_true", help="include .log files and pipeline_info/")
    ap.add_argument("--compare", nargs="+", metavar="MANIFEST.tsv")
    args = ap.parse_args()

    if args.compare:
        sys.exit(compare(args.compare))
    if not args.root or not args.out:
        ap.error("provide <dir> --out <manifest.tsv>, or --compare <manifests...>")
    build(Path(args.root), args.label, args.out, skip_logs=not args.keep_logs)


if __name__ == "__main__":
    main()
