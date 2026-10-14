#!/usr/bin/env python3
"""Where the findings of an AACR-Bench run are lost, stage by stage, summed over its pull requests.

    evals/aacr/funnel.py <dataset> <run> [<run> ...]      e.g.  evals/aacr/funnel.py ctx30 base14-1 base14-2

Reads each PR's report.json: `run.funnel` when the build records it (0.9.1+), else the same counts from the
chunk records and the rejected list. Also prints tool calls per chunk and the reviewer's confidence spread,
since a reviewer that reports little and reads nothing is a different problem from a critic that drops much.
"""
from __future__ import annotations

import glob
import json
import os
import statistics
import sys
from collections import Counter

AACR_DIR = os.environ.get("AACR_DIR", os.path.expanduser("~/.cache/code-reviewer-aacr"))
RESULTS = os.path.join(AACR_DIR, "aacr-bench", "evaluation", "results")


def funnel_of(report: dict) -> dict:
    if report.get("funnel"):
        return report["funnel"]
    kept = (report.get("findings") or []) + (report.get("advisory") or []) + (report.get("notes") or [])
    rejected = report.get("rejected") or []
    verdict = lambda f: (f.get("critique") or {}).get("verdict")
    reported = sum(c.get("findings", 0) or 0 for c in report.get("chunks") or [])
    reported += (report.get("sweep") or {}).get("findings", 0) - (report.get("sweep") or {}).get("duplicates", 0)
    return {
        "reported": reported,
        "static": sum(1 for f in kept + rejected if f.get("origin") == "static"),
        "validated": len(kept) + sum(1 for f in rejected if f.get("droppedReason") not in ("outside-changed-lines", "unknown-file", "lines-out-of-range")),
        "deduped": None,
        "critiqued": {
            "confirmed": sum(1 for f in kept if verdict(f) == "confirmed"),
            "uncertain": sum(1 for f in kept if verdict(f) == "uncertain"),
            "rejected": sum(1 for f in rejected if f.get("droppedReason") == "critique"),
            "unverified": sum(1 for f in kept if not f.get("critique")),
        },
        "belowThreshold": sum(1 for f in rejected if f.get("droppedReason") in ("below-threshold", "below-severity")),
        "main": len(report.get("findings") or []),
        "advisory": len(report.get("advisory") or []),
        "notes": len(report.get("notes") or []),
    }


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        sys.exit(__doc__)
    dataset, runs = args[0], args[1:]
    for run in runs:
        files = sorted(glob.glob(os.path.join(RESULTS, f"aacr_{dataset}", "code-reviewer", run, "*@*.json")))
        total: Counter = Counter()
        crit: Counter = Counter()
        tools: Counter = Counter()
        per_chunk: list[int] = []
        conf: list[float] = []
        reasons: Counter = Counter()
        prs = 0
        for path in files:
            with open(path, encoding="utf-8") as f:
                report = json.load(f).get("report")
            if not isinstance(report, dict):
                continue
            prs += 1
            fn = funnel_of(report)
            for k, v in fn.items():
                if isinstance(v, (int, float)):
                    total[k] += v
            for k, v in fn["critiqued"].items():
                crit[k] += v
            for c in report.get("chunks") or []:
                per_chunk.append(c.get("findings", 0) or 0)
                for k, v in (c.get("toolCalls") or {}).items():
                    tools[k] += v
            for x in report.get("rejected") or []:
                reasons[x.get("droppedReason") or "dropped"] += 1
            for x in (report.get("findings") or []) + (report.get("advisory") or []) + (report.get("rejected") or []):
                oc = (x.get("critique") or {}).get("originalConfidence")
                if oc is not None:
                    conf.append(oc)
        if not prs:
            sys.exit(f"no results for run {run!r} of dataset {dataset!r} under {RESULTS}")
        print(f"{run}: {prs} PRs, {len(per_chunk)} chunks")
        print(
            f"  reported {total['reported']} (+{total['static']} static) → critic: confirmed {crit['confirmed']}, "
            f"uncertain {crit['uncertain']}, rejected {crit['rejected']}, unverified {crit['unverified']} → "
            f"below threshold {total['belowThreshold']} → main {total['main']}, worth a look {total['advisory']}, notes {total['notes']}"
        )
        print(f"  rejected by reason: {dict(reasons)}")
        if per_chunk:
            print(
                f"  findings per chunk: median {statistics.median(per_chunk)}, zero in {per_chunk.count(0)} of {len(per_chunk)}; "
                f"tool calls per chunk: {', '.join(f'{k} {v / len(per_chunk):.2f}' for k, v in tools.most_common())}"
            )
        if conf:
            print(f"  reviewer confidence: median {statistics.median(conf):.2f}, below 0.5 in {sum(c < 0.5 for c in conf) / len(conf):.0%}")


if __name__ == "__main__":
    main()
