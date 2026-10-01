#!/usr/bin/env python3
"""Paired comparison of two AACR-Bench variants, with the uncertainty that repeated runs on a few dozen PRs carry.

    evals/aacr/stats.py <dataset> <runs A> <runs B> [--by-source] [--draws N]
    e.g.  evals/aacr/stats.py ctx30 i7-1,i7-2 maint-1,maint-2

Each variant is one or more runs of the same configuration; per PR the matched references and the findings are
averaged over its runs, then B is compared with A on the PRs both have. The recall difference uses the paired
cluster estimator of Miller (2024, "Adding error bars to evals"), clustered on repositories, with a t interval;
the F1 difference is a paired bootstrap over repositories. Read P(Δ>0) as the share of bootstrap draws in which
B beats A, not as a significance test. On ctx30 two runs per variant resolve differences of about 4 F1 points;
smaller effects need the held-out subset as well, or more runs.
"""
from __future__ import annotations

import glob
import json
import math
import os
import random
import sys
from collections import defaultdict

AACR_DIR = os.environ.get("AACR_DIR", os.path.expanduser("~/.cache/code-reviewer-aacr"))
EVAL = os.path.join(AACR_DIR, "aacr-bench", "evaluation")
T975 = {5: 2.571, 10: 2.228, 15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042, 40: 2.021, 60: 2.000}


def t_crit(df: int) -> float:
    return T975[min(T975, key=lambda k: abs(k - df))]


def sources() -> dict:
    """(path, note prefix) → "human" | "AI" for every reference comment of the benchmark."""
    with open(os.path.join(AACR_DIR, "aacr-bench", "dataset", "positive_samples.json"), encoding="utf-8") as f:
        prs = json.load(f)
    return {
        (c["path"], c["note"].strip()[:80]): ("AI" if c["is_ai_comment"] else "human")
        for pr in prs
        for c in pr["comments"]
    }


def load(dataset: str, run: str, src: dict) -> dict:
    """Per PR: reference matches (with their source) and the number of generated findings."""
    files = sorted(glob.glob(os.path.join(EVAL, "metrics", f"aacr_{dataset}", "*", run, "metrics_*.json")))
    files = [f for f in files if not f.endswith("_average.json")]
    if not files:
        sys.exit(f"no metrics for run {run!r} of dataset {dataset!r} under {EVAL}/metrics")
    with open(files[-1], encoding="utf-8") as f:
        data = json.load(f)
    results = os.path.join(EVAL, "results", f"aacr_{dataset}", "code-reviewer", run)
    out = {}
    for inst in data["eval_res"]:
        iid = inst["instance_id"]
        try:
            with open(os.path.join(results, f"{iid}.json"), encoding="utf-8") as f:
                report = json.load(f).get("report") or {}
        except FileNotFoundError:
            continue
        # Everything the harness counts as a review comment: findings, "worth a look" and maintainability notes.
        generated = [
            x
            for x in (report.get("findings") or []) + (report.get("advisory") or []) + (report.get("notes") or [])
            if x.get("title")
        ]
        refs = [
            (bool(c["semantic_match"]), src.get((c["path"], c["note"].strip()[:80]), "?"))
            for c in inst["comments"]
        ]
        out[iid] = {"refs": refs, "gen": len(generated)}
    return out


def variant(dataset: str, runs: list[str], src: dict) -> dict:
    loaded = [load(dataset, r, src) for r in runs]
    common = set.intersection(*(set(l) for l in loaded))
    out = {}
    for iid in sorted(common):
        n = len(loaded[0][iid]["refs"])
        out[iid] = {
            "n": n,
            "m": sum(sum(m for m, _ in l[iid]["refs"]) for l in loaded) / len(loaded),
            "g": sum(l[iid]["gen"] for l in loaded) / len(loaded),
            "by_source": {
                s: (
                    sum(1 for _, t in loaded[0][iid]["refs"] if t == s),
                    sum(sum(m for m, t in l[iid]["refs"] if t == s) for l in loaded) / len(loaded),
                )
                for s in ("human", "AI")
            },
        }
    return out


def f1(m: float, g: float, n: float) -> float:
    return 2 * m / (g + n) if g + n else 0.0


def totals(v: dict) -> dict:
    n = sum(x["n"] for x in v.values())
    m = sum(x["m"] for x in v.values())
    g = sum(x["g"] for x in v.values())
    return {"n": n, "m": m, "g": g, "R": m / n if n else 0, "P": m / g if g else 0, "F1": f1(m, g, n)}


def clusters(v: dict) -> dict:
    by: dict = defaultdict(lambda: {"n": 0, "m": 0.0, "g": 0.0})
    for iid, x in v.items():
        c = by[iid.split("@")[0]]
        for k in c:
            c[k] += x[k]
    return by


def recall_diff(a: dict, b: dict) -> tuple[float, float, tuple[float, float], int]:
    ca, cb = clusters(a), clusters(b)
    keys = sorted(ca)
    total = sum(ca[k]["n"] for k in keys)
    d = [cb[k]["m"] - ca[k]["m"] for k in keys]
    delta = sum(d) / total
    m = len(keys)
    se = math.sqrt(m / (m - 1) * sum((di - delta * ca[k]["n"]) ** 2 for di, k in zip(d, keys))) / total
    t = t_crit(m - 1)
    return delta, se, (delta - t * se, delta + t * se), m


def f1_diff(a: dict, b: dict, draws: int, seed: int = 1) -> tuple[float, tuple[float, float], float]:
    ca, cb = clusters(a), clusters(b)
    keys = sorted(ca)
    rnd = random.Random(seed)

    def score(c: dict, ks: list[str]) -> float:
        return f1(sum(c[k]["m"] for k in ks), sum(c[k]["g"] for k in ks), sum(c[k]["n"] for k in ks))

    observed = score(cb, keys) - score(ca, keys)
    ds = sorted(score(cb, ks) - score(ca, ks) for ks in ([rnd.choice(keys) for _ in keys] for _ in range(draws)))
    return observed, (ds[int(0.025 * draws)], ds[int(0.975 * draws)]), sum(1 for x in ds if x > 0) / draws


def pct(x: float) -> str:
    return f"{100 * x:5.1f}%"


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 3:
        sys.exit(__doc__)
    dataset, runs_a, runs_b = args[0], args[1].split(","), args[2].split(",")
    draws = int(sys.argv[sys.argv.index("--draws") + 1]) if "--draws" in sys.argv else 10_000
    src = sources()
    a, b = variant(dataset, runs_a, src), variant(dataset, runs_b, src)
    common = sorted(set(a) & set(b))
    if len(common) < len(a) or len(common) < len(b):
        print(f"note: comparing the {len(common)} PRs both variants have (A {len(a)}, B {len(b)})")
    a = {k: a[k] for k in common}
    b = {k: b[k] for k in common}
    for name, runs, v in (("A", runs_a, a), ("B", runs_b, b)):
        t = totals(v)
        print(
            f"{name} {'+'.join(runs):28} findings {t['g']:6.1f}  matched {t['m']:6.1f}  "
            f"P {pct(t['P'])}  R {pct(t['R'])}  F1 {pct(t['F1'])}"
        )
        if "--by-source" in sys.argv:
            for s in ("human", "AI"):
                n = sum(x["by_source"][s][0] for x in v.values())
                m = sum(x["by_source"][s][1] for x in v.values())
                print(f"    recall on {s:5} references: {m:5.1f}/{n:<4d} {pct(m / n if n else 0)}")
    delta, se, ci, m = recall_diff(a, b)
    observed, (lo, hi), p = f1_diff(a, b, draws)
    print(
        f"B − A: recall {100 * delta:+.1f} points (SE {100 * se:.1f}, 95% CI {100 * ci[0]:+.1f}..{100 * ci[1]:+.1f}, "
        f"{m} repositories); F1 {100 * observed:+.1f} points (95% bootstrap {100 * lo:+.1f}..{100 * hi:+.1f}); "
        f"P(B > A) = {p:.2f}"
    )


if __name__ == "__main__":
    main()
