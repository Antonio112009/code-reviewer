"""Scores judged runs of the Martian benchmark: precision, recall and F1 per profile, recall by severity and
repository, candidates and cost per pull request.

    report.py <run-id>[:<judge>[:<tier>]] ...   e.g. report.py m-1 m-1:claude-opus-4-5-20251101-nothink:all

<judge> names a judging as judge.py saved it (default sonnet; claude-opus-4-5-20251101-nothink for the
leaderboard's judge model without extended thinking), <tier> is main (default) or all.

Profiles (the benchmark's `score_profiles.py`): strict = bug, security, concurrency, data, api; core adds
perf, test_gap, doc_defect; all adds style, speculative. A true positive or false negative counts in a
profile when its golden comment's category is in it; false positives always count.
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

MARTIAN_DIR = Path(os.environ.get("MARTIAN_DIR", os.path.expanduser("~/.cache/code-reviewer-martian")))
PROFILES = {
    "strict": {"bug", "security", "concurrency", "data", "api"},
    "core": {"bug", "security", "concurrency", "data", "api", "perf", "test_gap", "doc_defect"},
    "all": {"bug", "security", "concurrency", "data", "api", "perf", "test_gap", "doc_defect", "style", "speculative"},
}
SEVERITIES = ["Critical", "High", "Medium", "Low"]


def load(spec: str) -> tuple[dict, dict, dict]:
    """`<run-id>[:<judge>[:<tier>]]`: the run's results and one of its judgings (default sonnet, main)."""
    parts = spec.split(":")
    run_id = parts[0]
    judge = parts[1] if len(parts) > 1 and parts[1] else "sonnet"
    tier = parts[2] if len(parts) > 2 and parts[2] else "main"
    run_dir = MARTIAN_DIR / "results" / run_id
    with open(run_dir / f"eval-{judge}-{tier}.json", encoding="utf-8") as f:
        data = json.load(f)
    costs = {}
    for path in run_dir.glob("*.json"):
        if path.name.startswith("eval") or path.name == "provenance.json":
            continue
        with open(path, encoding="utf-8") as f:
            r = json.load(f)
        report = r.get("report") or {}
        costs[r["url"]] = {"cost": (report.get("cost") or {}).get("amount"), "seconds": r.get("duration_seconds")}
    return data["meta"], data["evaluations"], costs


def pct(x: float) -> str:
    return f"{100 * x:5.1f}%"


def score(evaluations: dict, cats: set) -> dict:
    tp = fp = fn = 0
    for pr in evaluations.values():
        for ev in pr.values():
            if ev.get("skipped"):
                continue
            tp += sum(1 for t in ev["true_positives"] if t.get("category") in cats)
            fn += sum(1 for t in ev["false_negatives"] if t.get("category") in cats)
            fp += ev["fp"]
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "P": p, "R": r, "F1": 2 * p * r / (p + r) if p + r else 0.0}


def main() -> None:
    runs = sys.argv[1:]
    if not runs or runs[0] in ("-h", "--help"):
        sys.exit(__doc__)
    sets = {}
    for path in (MARTIAN_DIR / "bench" / "offline" / "golden_comments").glob("*.json"):
        with open(path, encoding="utf-8") as f:
            for pr in json.load(f):
                sets[pr["url"]] = path.stem
    for run_id in runs:
        meta, evaluations, costs = load(run_id)
        judged = [url for url, pr in evaluations.items() if not any(ev.get("skipped") for ev in pr.values())]
        print(f"== {run_id}: tool {meta['tool']}, judge {meta['judge_model']}, tier {meta.get('tier')}, {len(judged)} of {len(evaluations)} PRs judged, {meta['judge_calls']} judge calls, benchmark {meta['benchmark_commit'][:12]}")
        for name, cats in PROFILES.items():
            s = score(evaluations, cats)
            print(f"   {name:6} TP {s['tp']:3}  FP {s['fp']:3}  FN {s['fn']:3}   P {pct(s['P'])}  R {pct(s['R'])}  F1 {pct(s['F1'])}")
        by_sev: dict = defaultdict(lambda: [0, 0])
        by_set: dict = defaultdict(lambda: [0, 0])
        cands = 0
        for url, pr in evaluations.items():
            for ev in pr.values():
                if ev.get("skipped"):
                    continue
                cands += ev["total_candidates"]
                for t in ev["true_positives"]:
                    by_sev[t.get("severity")][0] += 1
                    by_set[sets.get(url, "?")][0] += 1
                for t in ev["true_positives"] + ev["false_negatives"]:
                    by_sev[t.get("severity")][1] += 1
                    by_set[sets.get(url, "?")][1] += 1
        print("   recall by severity: " + "  ".join(f"{s} {by_sev[s][0]}/{by_sev[s][1]}" for s in SEVERITIES if by_sev[s][1]))
        print("   recall by repository: " + "  ".join(f"{k} {v[0]}/{v[1]}" for k, v in sorted(by_set.items())))
        known = [c for c in costs.values() if c.get("cost")]
        cost = sum(c["cost"] for c in known)
        secs = sum(c.get("seconds") or 0 for c in costs.values())
        print(f"   candidates per PR {cands / max(1, len(judged)):.1f}; review cost ${cost:.2f} over {len(known)} priced PRs; {secs / 60:.0f} min of reviews")
        errors = sum(ev.get("errors_count", 0) for pr in evaluations.values() for ev in pr.values() if not ev.get("skipped"))
        if errors:
            print(f"   judge errors: {errors} (counted as no match)")


if __name__ == "__main__":
    main()
