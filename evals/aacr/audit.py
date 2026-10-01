#!/usr/bin/env python3
"""Blind audit of a run's findings: what share is real, by the scores the reviewer and the critic gave them.

The benchmark's references miss most real defects and include remarks that are wrong about the code, so its
precision says little about a report. A blind audit reads the code instead: an auditor (a person, or an agent
given AUDIT_PROMPT.md) sees each finding without its severity, confidence, tier or benchmark match and labels it.

    evals/aacr/audit.py sample <dataset> <run> <dir> [--n N] [--parts K] [--seed S]
    evals/aacr/audit.py summarize <dir>

`sample` writes <dir>/part<k>.json (the blind inputs), <dir>/index.json (the hidden fields) and
<dir>/AUDIT_PROMPT.md (the instructions, one copy per part). Each auditor writes <dir>/result<k>.json;
`summarize` joins the labels with the hidden fields and prints the tables. Auditors read the clones with
`git show <head>:<file>` and never check anything out: the clones are shared with benchmark runs.
"""
from __future__ import annotations

import glob
import json
import os
import random
import subprocess
import sys
from collections import Counter, defaultdict

AACR_DIR = os.environ.get("AACR_DIR", os.path.expanduser("~/.cache/code-reviewer-aacr"))
EVAL = os.path.join(AACR_DIR, "aacr-bench", "evaluation")
REAL = {"real", "real-minor"}

PROMPT = """You are auditing code-review findings produced by an LLM code reviewer on real open-source pull requests.
Nobody has verified these findings. Decide, by reading the actual code, whether each finding is a real defect or
noise. This is read-only research: do not modify any repository, and write nothing but the result file.

Input: {part} — a JSON array. Each item has: n (id), repo (local git clone), base (the fork point of the pull
request) and head (commit shas), file, lines [start, end] (in the head version), title, description, failurePath
(the reviewer's claimed path to failure, may be empty), suggestion. Items are grouped by pull request.

Read code WITHOUT changing the clones (they are shared with running jobs: NEVER checkout, switch, reset, clean,
stash, fetch or pull, and never write inside a clone):
- file at head: `git -C <repo> show <head>:<file>` (pipe through `nl -ba | sed -n 'A,Bp'`);
- the pull request's own change: `git -C <repo> diff <base> <head> -- <file>`;
- other files: `git -C <repo> grep -n <pattern> <head> -- <path>`.
Never trust the working tree of a clone; always go through the shas. If a commit is missing locally, classify
from the description only and add "unverified": true.

Verdict, exactly one per finding:
- "real": a concrete defect introduced or exposed by this change that would plausibly cause wrong behaviour, a
  crash, a leak, a security issue or a real performance problem; you can see the failure path in the code.
- "real-minor": correct but low impact (edge case, unlikely input, cosmetic misbehaviour) — still a defect.
- "debatable": depends on intent or unstated assumptions ("could be null if a caller…", design choices,
  defensive checks the code arguably does not need).
- "wrong": the claim is false when you read the code (handled elsewhere, the API does not behave like that,
  lines misread).
- "not-a-defect": style, naming, docs, tests, or a remark with no failure.

Also give: "preexisting" (true if the problem exists in the base version and the change did not introduce or
expose it); "severity" — the severity YOU would assign: "critical" | "major" | "minor" | "info" (true
observation, no realistic failure) | "none" (should not be reported); "same_as" — the n of an EARLIER item in
this file that states the same underlying concern, else null.

Be skeptical and concrete: verify the API semantics you rely on, check callers and callees when the claim
depends on them, judge each finding by its headline claim.

Write a JSON array to {result} with objects {{"n", "verdict", "preexisting", "severity", "same_as", "reason"}}
("reason": one or two sentences citing the code), one object per input item. Then reply with the counts per
verdict and the two or three most instructive wrong or debatable findings.
"""


def merge_base(repo: str, base: str, head: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", repo, "merge-base", base, head], capture_output=True, text=True, check=True
        ).stdout.strip() or base
    except subprocess.CalledProcessError:
        return base


def matched_notes(dataset: str, run: str) -> dict:
    """instance → the generated comment texts the judge matched to a reference."""
    files = sorted(glob.glob(os.path.join(EVAL, "metrics", f"aacr_{dataset}", "*", run, "metrics_*.json")))
    files = [f for f in files if not f.endswith("_average.json")]
    if not files:
        return {}
    with open(files[-1], encoding="utf-8") as f:
        data = json.load(f)
    return {
        inst["instance_id"]: {c["matched_note"] for c in inst["comments"] if c["semantic_match"]}
        for inst in data["eval_res"]
    }


def note_of(f: dict) -> str:
    parts = [(f.get("title") or "").strip(), (f.get("description") or "").strip(), (f.get("suggestion") or "").strip()]
    return "\n".join(p for p in parts if p).strip()


def sample(dataset: str, run: str, out: str, n: int, parts: int, seed: int) -> None:
    matched = matched_notes(dataset, run)
    items = []
    for rj in sorted(glob.glob(os.path.join(EVAL, "results", f"aacr_{dataset}", "code-reviewer", run, "runs", "*", "run.json"))):
        inst = os.path.basename(os.path.dirname(rj))
        with open(rj, encoding="utf-8") as f:
            r = json.load(f)
        target = r["target"]
        base = target.get("mergeBase") or target["baseSha"]
        for tier in ("findings", "advisory"):
            for x in r.get(tier) or []:
                items.append(
                    {
                        "inst": inst,
                        "repo": r["repo"]["root"],
                        "base": base,
                        "head": target["headSha"],
                        "id": x["id"],
                        "file": x["file"],
                        "lines": [x.get("startLine"), x.get("endLine")],
                        "title": x["title"],
                        "description": x.get("description"),
                        "failurePath": x.get("failurePath"),
                        "suggestion": x.get("suggestion"),
                        "severity": x["severity"],
                        "confidence": x["confidence"],
                        "tier": "main" if tier == "findings" else "worth a look",
                        "replacement": x.get("replacement") is not None,
                        "matched": note_of(x) in matched.get(inst, set()),
                    }
                )
    if n and n < len(items):
        items = random.Random(seed).sample(items, n)
    by_pr: dict = defaultdict(list)
    for it in items:
        by_pr[it["inst"]].append(it)
    groups: list[list[dict]] = [[] for _ in range(parts)]
    for _, its in sorted(by_pr.items(), key=lambda kv: -len(kv[1])):
        min(groups, key=len).extend(sorted(its, key=lambda x: (x["file"], x["lines"][0] or 0)))
    os.makedirs(out, exist_ok=True)
    blind = ("n", "repo", "base", "head", "file", "lines", "title", "description", "failurePath", "suggestion")
    index = []
    counter = 0
    for k, group in enumerate(groups, 1):
        rows = []
        for it in group:
            counter += 1
            it = {**it, "n": counter, "part": k}
            index.append(it)
            rows.append({key: it[key] for key in blind})
        with open(os.path.join(out, f"part{k}.json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=1, ensure_ascii=False)
        with open(os.path.join(out, f"AUDIT_PROMPT{k}.md"), "w", encoding="utf-8") as f:
            f.write(PROMPT.format(part=os.path.join(out, f"part{k}.json"), result=os.path.join(out, f"result{k}.json")))
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1, ensure_ascii=False)
    print(f"{len(index)} findings of {len(by_pr)} PRs in {parts} part(s) under {out}")


def summarize(out: str) -> None:
    with open(os.path.join(out, "index.json"), encoding="utf-8") as f:
        index = json.load(f)
    labels = {}
    for rf in glob.glob(os.path.join(out, "result*.json")):
        with open(rf, encoding="utf-8") as f:
            for x in json.load(f):
                labels[x["n"]] = x
    rows = [
        {**it, "verdict": labels[it["n"]]["verdict"], "audit_severity": labels[it["n"]].get("severity")}
        for it in index
        if it["n"] in labels
    ]
    if not rows:
        sys.exit("no result files yet")
    counts = Counter(r["verdict"] for r in rows)
    real = sum(1 for r in rows if r["verdict"] in REAL)
    print(f"audited {len(rows)} of {len(index)}: {dict(counts)} → {100 * real / len(rows):.0f}% real")

    def table(name: str, key, order=None) -> None:
        groups: dict = defaultdict(list)
        for r in rows:
            groups[key(r)].append(r)
        print(f"-- {name}")
        for k in order or sorted(groups, key=lambda k: -len(groups[k])):
            if k in groups:
                v = groups[k]
                c = Counter(x["verdict"] for x in v)
                share = 100 * (c["real"] + c["real-minor"]) / len(v)
                print(
                    f"   {str(k):18} n {len(v):3}  real {c['real']:3}  minor {c['real-minor']:3}  "
                    f"debatable {c['debatable']:3}  wrong {c['wrong']:3}  not-a-defect {c['not-a-defect']:3}  → {share:3.0f}% real"
                )

    bucket = lambda c: "0.9+" if c >= 0.9 else "0.75-0.9" if c >= 0.75 else "0.6-0.75" if c >= 0.6 else "0.45-0.6" if c >= 0.45 else "<0.45"
    table("severity", lambda r: r["severity"], ["critical", "major", "minor", "info"])
    table("confidence", lambda r: bucket(r["confidence"]), ["0.9+", "0.75-0.9", "0.6-0.75", "0.45-0.6", "<0.45"])
    table("tier", lambda r: r["tier"], ["main", "worth a look"])
    table("benchmark match", lambda r: "matched" if r["matched"] else "not matched")
    table("one-click replacement", lambda r: "with" if r["replacement"] else "without")
    print("-- reviewer severity → auditor severity")
    for s in ("critical", "major", "minor", "info"):
        v = [r for r in rows if r["severity"] == s]
        if v:
            print(f"   {s:8} n {len(v):3} → {dict(Counter(r['audit_severity'] for r in v))}")


if __name__ == "__main__":
    if len(sys.argv) >= 5 and sys.argv[1] == "sample":
        opt = lambda name, default: int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default
        sample(sys.argv[2], sys.argv[3], sys.argv[4], opt("--n", 0), opt("--parts", 1), opt("--seed", 1))
    elif len(sys.argv) == 3 and sys.argv[1] == "summarize":
        summarize(sys.argv[2])
    else:
        sys.exit(__doc__)
