"""Scores AACR-Bench runs by context level (Diff / File / Repo) and category, averaged over repeated runs.

    evals/aacr/report.py <dataset> <run-id> [<run-id> ...]      e.g.  report.py ctx30 base-1 base-2

Reads the newest metrics file of each run under $AACR_DIR (default ~/.cache/code-reviewer-aacr) and the
benchmark's reference comments, which carry the level and category the harness metrics leave out.
"""
from __future__ import annotations

import glob
import json
import os
import statistics
import sys
from collections import defaultdict

AACR_DIR = os.environ.get("AACR_DIR", os.path.expanduser("~/.cache/code-reviewer-aacr"))
EVAL = os.path.join(AACR_DIR, "aacr-bench", "evaluation")


def key(head: str, path: str, line, note: str) -> tuple:
    return (head[:7], path, line, note.strip()[:80])


def labels() -> dict:
    """(head, path, from_line, note prefix) → (context level, category, source) for every reference comment."""
    out = {}
    with open(os.path.join(AACR_DIR, "aacr-bench", "dataset", "positive_samples.json"), encoding="utf-8") as f:
        for pr in json.load(f):
            for c in pr["comments"]:
                source = "AI" if c["is_ai_comment"] else "human"
                out[key(pr["target_commit"], c["path"], c["from_line"], c["note"])] = (c["context"], c["category"], source)
    return out


def score(dataset: str, run: str, refs: dict) -> dict:
    files = sorted(glob.glob(os.path.join(EVAL, "metrics", f"aacr_{dataset}", "*", run, "metrics_*.json")))
    files = [f for f in files if not f.endswith("_average.json")]
    if not files:
        sys.exit(f"no metrics for run {run!r} of dataset {dataset!r} under {EVAL}/metrics")
    # `--eval-rounds N` writes metrics_<reviewer>_<stamp>_round_<k>.json per judging: average the newest group.
    newest = files[-1].split("_round_")[0]
    rounds = [f for f in files if f.split("_round_")[0] == newest] if "_round_" in files[-1] else [files[-1]]
    by = defaultdict(lambda: [0, 0.0, 0.0])  # expected, semantic, line (averaged over the judgings)
    for path in rounds:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for inst in data["eval_res"]:
            head = inst["instance_id"].split("@")[1]
            for c in inst["comments"]:
                level, category, source = refs.get(key(head, c["path"], c["from_line"], c["note"]), ("?", "?", "?"))
                for k in ("all", f"level:{level}", f"category:{category}", f"source:{source}"):
                    if path == rounds[0]:
                        by[k][0] += 1
                    by[k][1] += bool(c["semantic_match"]) / len(rounds)
                    by[k][2] += bool(c["line_match"]) / len(rounds)
    generated = data["summary"]["generated_notes"]
    out = {k: {"expected": e, "semantic": s, "line": l} for k, (e, s, l) in by.items()}
    out["generated"] = generated
    out["missing"] = data["summary"].get("missing_instances", 0)
    return out


def pct(x: float) -> str:
    return f"{100 * x:5.1f}%"


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    dataset, runs = sys.argv[1], sys.argv[2:]
    refs = labels()
    scores = {r: score(dataset, r, refs) for r in runs}
    rows = sorted({k for s in scores.values() for k in s if isinstance(s[k], dict)}, key=lambda k: (k != "all", k))
    print(f"{'':34s}" + "".join(f"{r:>18s}" for r in runs) + ("       mean" if len(runs) > 1 else ""))
    for label, fn in (
        ("findings", lambda s: s["generated"]),
        ("precision (semantic)", lambda s: s["all"]["semantic"] / s["generated"] if s["generated"] else 0),
        ("F1 (semantic)", lambda s: f1(s)),
    ):
        vals = [fn(scores[r]) for r in runs]
        fmt = (lambda v: f"{v:>18d}") if label == "findings" else (lambda v: f"{pct(v):>18s}")
        mean = statistics.mean(vals)
        print(f"{label:34s}" + "".join(fmt(v) for v in vals) + (f"  {mean:9.1f}" if label == "findings" and len(runs) > 1 else f"  {pct(mean)}" if len(runs) > 1 else ""))
    print("recall (semantic):")
    for k in rows:
        vals = []
        cells = ""
        for r in runs:
            v = scores[r].get(k, {"expected": 0, "semantic": 0, "line": 0})
            rec = v["semantic"] / v["expected"] if v["expected"] else 0
            vals.append(rec)
            cells += f"{v['semantic']:>5.0f}/{v['expected']:<4d}{pct(rec):>8s}"
        print(f"  {k:32s}" + cells + (f"  {pct(statistics.mean(vals))}" if len(runs) > 1 else ""))
    missing = {r: scores[r]["missing"] for r in runs if scores[r]["missing"]}
    if missing:
        print(f"missing instances (left out of every metric): {missing}")


def f1(s: dict) -> float:
    p = s["all"]["semantic"] / s["generated"] if s["generated"] else 0
    r = s["all"]["semantic"] / s["all"]["expected"] if s["all"]["expected"] else 0
    return 2 * p * r / (p + r) if p + r else 0


if __name__ == "__main__":
    main()
