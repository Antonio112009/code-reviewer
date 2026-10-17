#!/usr/bin/env python3
"""Where each reviewer finds bugs on the Martian benchmark: precision, recall and F1 (core profile) averaged over
its runs, and recall by bug category, severity and repository, with findings and cost per pull request.

    breakdown.py [--json out.json] <label>=<spec>[,<spec>...] ...

<spec> is what report.py takes (`<run-id>:<judge>:<tier>` or a judging file). Several specs under one label are
runs of the same reviewer: P, R and F1 are averaged over them, recall by category / severity / repository is
pooled (the golden set is the same in every run, so pooling equals averaging).

    breakdown.py "Code Reviewer 0.12.0=r12-1:claude-opus-4-5-20251101-nothink:all,r12-2:…:all" \\
                 "Qodo Extended=baseline-qodo-extended-v2:claude-opus-4-5-20251101-nothink:main"
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from report import PROFILES, SEVERITIES, load, score  # noqa: E402

CORE = PROFILES["core"]
# Display order and names of the core profile's categories.
CATEGORIES = [
    ("bug", "Logic bugs"),
    ("concurrency", "Concurrency"),
    ("api", "API contracts"),
    ("security", "Security"),
    ("doc_defect", "Docs that lie"),
    ("data", "Data integrity"),
    ("perf", "Performance"),
    ("test_gap", "Test gaps"),
]


def repo_of(url: str) -> str:
    # https://github.com/<owner>/<repo>/pull/<n>
    return url.split("/")[4] if url.count("/") >= 4 else url


def reviewer(label: str, specs: list[str]) -> dict:
    runs = []
    found = defaultdict(int)
    total = defaultdict(int)
    candidates = prs = 0
    cost = 0.0
    priced = 0
    for spec in specs:
        _meta, evaluations, costs = load(spec)
        runs.append(score(evaluations, CORE))
        for url, pr in evaluations.items():
            for ev in pr.values():
                if ev.get("skipped"):
                    continue
                prs += 1
                candidates += ev.get("total_candidates", 0)
                for hit, golden in [(True, g) for g in ev["true_positives"]] + [(False, g) for g in ev["false_negatives"]]:
                    if golden.get("category") not in CORE:
                        continue
                    for key in (f"cat:{golden['category']}", f"sev:{golden.get('severity')}", f"repo:{repo_of(url)}"):
                        total[key] += 1
                        found[key] += hit
        for c in costs.values():
            if c.get("cost") is not None:
                cost += c["cost"]
                priced += 1
    avg = {k: sum(r[k] for r in runs) / len(runs) for k in ("P", "R", "F1")}

    def rate(key: str) -> dict:
        return {"found": found[key] / len(specs), "of": total[key] // len(specs), "recall": found[key] / total[key] if total[key] else None}

    repos = sorted({k[5:] for k in total if k.startswith("repo:")})
    return {
        "label": label,
        "runs": len(specs),
        "precision": round(100 * avg["P"], 1),
        "recall": round(100 * avg["R"], 1),
        "f1": round(100 * avg["F1"], 1),
        "f1_runs": [round(100 * r["F1"], 1) for r in runs],
        "findings_per_pr": round(candidates / prs, 1) if prs else None,
        "cost_per_pr": round(cost / priced, 2) if priced else None,
        "category": {c: rate(f"cat:{c}") for c, _ in CATEGORIES},
        "severity": {s: rate(f"sev:{s}") for s in SEVERITIES},
        "repository": {r: rate(f"repo:{r}") for r in repos},
    }


def main() -> None:
    args = sys.argv[1:]
    out = None
    if args[:1] == ["--json"]:
        out, args = args[1], args[2:]
    if not args:
        sys.exit(__doc__)
    rows = []
    for arg in args:
        label, _, specs = arg.partition("=")
        rows.append(reviewer(label, [s for s in specs.split(",") if s]))
    names = dict(CATEGORIES)
    w = max(len(r["label"]) for r in rows)
    print(f"{'':{w}}  {'P':>5} {'R':>5} {'F1':>5}  {'/PR':>4} {'$/PR':>5}")
    for r in rows:
        cost = f"{r['cost_per_pr']:.2f}" if r["cost_per_pr"] is not None else "—"
        print(f"{r['label']:{w}}  {r['precision']:5.1f} {r['recall']:5.1f} {r['f1']:5.1f}  {r['findings_per_pr']:4.1f} {cost:>5}  runs {r['f1_runs']}")
    for section, keys in (("category", [c for c, _ in CATEGORIES]), ("severity", SEVERITIES)):
        print(f"\nrecall by {section}")
        print(f"{'':{w}}  " + " ".join(f"{(names.get(k, k))[:11]:>11}" for k in keys))
        for r in rows:
            cells = []
            for k in keys:
                x = r[section][k]
                cells.append(f"{100 * x['recall']:5.0f}% /{x['of']:>3}" if x["recall"] is not None else f"{'—':>11}")
            print(f"{r['label']:{w}}  " + " ".join(f"{c:>11}" for c in cells))
    if out:
        Path(out).write_text(json.dumps({"categories": CATEGORIES, "severities": SEVERITIES, "reviewers": rows}, indent=1) + "\n")
        print(f"\n→ {out}")


if __name__ == "__main__":
    main()
