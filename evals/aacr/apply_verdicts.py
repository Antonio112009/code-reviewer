"""Scores a critic without re-running the reviews: applies the verdicts of `recritique.mts` to a finished run's
findings and writes them as a new run, which `run.sh <new-run-id> --subset <dataset> --stage eval` then judges.

    evals/aacr/apply_verdicts.py <dataset> <run> <verdicts.json> <new-run-id> [--notes keep|drop|critic] [--cap N]

Rejected findings are dropped; the rest take the critic's title, confidence and severity and go to the main list
(confidence ≥ 0.6) or "worth a look" (≥ 0.3), as the pipeline does at full depth. Maintainability notes (titles
starting with "Maintainability:") never go through the critic unless --notes critic; --cap keeps the first N.
"""
from __future__ import annotations

import glob
import json
import os
import shutil
import sys
from collections import Counter

AACR_DIR = os.environ.get("AACR_DIR", os.path.expanduser("~/.cache/code-reviewer-aacr"))
RESULTS = os.path.join(AACR_DIR, "aacr-bench", "evaluation", "results")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 4:
        sys.exit(__doc__)
    dataset, run, verdicts_file, new = args
    notes_mode = sys.argv[sys.argv.index("--notes") + 1] if "--notes" in sys.argv else "keep"
    cap = int(sys.argv[sys.argv.index("--cap") + 1]) if "--cap" in sys.argv else 0
    src = os.path.join(RESULTS, f"aacr_{dataset}", "code-reviewer", run)
    dst = os.path.join(RESULTS, f"aacr_{dataset}", "code-reviewer", new)
    os.makedirs(dst, exist_ok=True)
    with open(verdicts_file, encoding="utf-8") as f:
        verdicts = {(v["inst"], v["id"]): v for v in json.load(f)}
    stat: Counter = Counter()
    for path in sorted(glob.glob(os.path.join(src, "*@*.json"))):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        inst = os.path.basename(path)[:-5]
        report = data.get("report")
        if not isinstance(report, dict):
            shutil.copy(path, dst)
            continue
        main, advisory, notes = [], [], []
        for x in (report.get("findings") or []) + (report.get("advisory") or []):
            if x["title"].lower().startswith("maintainability:") and notes_mode != "critic":
                notes.append(x)
                continue
            v = verdicts.get((inst, x["id"]))
            if v is None:
                stat["no verdict"] += 1
                (main if x["confidence"] >= 0.6 else advisory).append(x)
                continue
            if v.get("verdict") == "rejected":
                stat["rejected"] += 1
                continue
            y = {
                **x,
                "title": v.get("correctedTitle") or x["title"],
                "confidence": v.get("confidence", x["confidence"]),
                "severity": v.get("severity") or x["severity"],
            }
            if y["confidence"] < 0.3:
                stat["below 0.3"] += 1
                continue
            tier = "main" if y["confidence"] >= 0.6 else "worth a look"
            stat[tier] += 1
            (main if tier == "main" else advisory).append(y)
        if notes_mode == "keep":
            if cap:
                notes = notes[:cap]
            advisory += notes
            stat["notes"] += len(notes)
        with open(os.path.join(dst, f"{inst}.json"), "w", encoding="utf-8") as f:
            json.dump({**data, "report": {**report, "findings": main, "advisory": advisory}}, f)
    print(new, dict(stat))


if __name__ == "__main__":
    main()
