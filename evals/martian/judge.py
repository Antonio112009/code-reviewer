"""Judges a run (or a published tool's candidates) against the golden comments with the benchmark's own prompt.

    judge.py <run-id> [--tier main|all] [--judge-model sonnet] [--concurrency 8]
    judge.py --baseline <tool> [--judge-model sonnet]        e.g. --baseline claude-code

The judge prompt is read verbatim from the pinned benchmark checkout (offline/code_review_benchmark/
step3_judge_comments.py, MIT) and answered by `claude -p`; every (golden, candidate) pair of a pull request is
judged, and the matching rule is the benchmark's: a golden comment is matched by the candidate the judge is
most confident about, a candidate counts as matched when it is that best match for some golden comment, the
rest are false positives. Verdicts are cached under $MARTIAN_DIR/judge-cache by judge model and texts.

What differs from the published pipeline: our candidates are the findings themselves (title and description,
one per finding; `--tier all` adds "worth a look" and maintainability notes), not issues an LLM extracted from
comment bodies, and there is no LLM de-duplication step. A published tool's candidates (`--baseline`) are
taken as checked in, with their de-duplication groups, so the two are comparable under this judge.

Output: $MARTIAN_DIR/results/<run-id>/evaluations.json in the benchmark's shape ({url: {tool: {tp, fp, fn,
true_positives, false_negatives, false_positives, ...}}}) plus judge metadata; report.py scores it.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MARTIAN_DIR = Path(os.environ.get("MARTIAN_DIR", os.path.expanduser("~/.cache/code-reviewer-martian")))
BENCH = MARTIAN_DIR / "bench" / "offline"
PUBLISHED_JUDGE_DIR = "anthropic_claude-opus-4-5-20251101"
TOOL = "code-reviewer"


def opt(name: str, default):
    if name in sys.argv:
        value = sys.argv[sys.argv.index(name) + 1]
        return type(default)(value) if default is not None else value
    return default


def golden_by_url() -> dict:
    out = {}
    for path in sorted((BENCH / "golden_comments").glob("*.json")):
        with open(path, encoding="utf-8") as f:
            for pr in json.load(f):
                out[pr["url"]] = {"set": path.stem, "title": pr.get("pr_title"), "comments": pr["comments"]}
    return out


def judge_prompt() -> str:
    src = (BENCH / "code_review_benchmark" / "step3_judge_comments.py").read_text(encoding="utf-8")
    m = re.search(r'JUDGE_PROMPT = """(.*?)"""', src, re.S)
    if not m:
        sys.exit("JUDGE_PROMPT not found in the benchmark checkout: run evals/martian/setup.sh")
    return m.group(1)


def ask(prompt: str, model: str) -> dict:
    """One judge call through `claude -p`; the answer is the JSON object the prompt asks for."""
    key = hashlib.sha256(f"{model}\n{prompt}".encode()).hexdigest()
    cached = MARTIAN_DIR / "judge-cache" / f"{key}.json"
    if cached.exists():
        with open(cached, encoding="utf-8") as f:
            return json.load(f)
    command = [
        "claude", "-p", "--model", model, "--output-format", "json",
        "--system-prompt", "You are a precise evaluator. Respond with valid JSON only.",
        "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence",
    ]
    last = ""
    for attempt in range(3):
        try:
            proc = subprocess.run(command, input=prompt, capture_output=True, text=True, timeout=120)
            data = json.loads(proc.stdout)
            if data.get("is_error"):
                raise ValueError(str(data.get("result"))[:200])
            text = str(data.get("result", ""))
            m = re.search(r"\{.*\}", text, re.S)
            verdict = json.loads(m.group(0)) if m else {}
            result = {
                "match": bool(verdict.get("match")),
                "confidence": float(verdict.get("confidence") or 0),
                "reasoning": str(verdict.get("reasoning") or "")[:500],
                "cost": data.get("total_cost_usd"),
            }
            cached.parent.mkdir(parents=True, exist_ok=True)
            with open(cached, "w", encoding="utf-8") as f:
                json.dump(result, f)
            return result
        except Exception as err:  # noqa: BLE001
            last = f"{err}"[:200]
    return {"error": last or "judge failed", "match": False, "confidence": 0.0}


def evaluate(golden: list[dict], candidates: list[str], groups: list[list[int]] | None, model: str, template: str,
             pool: ThreadPoolExecutor) -> dict:
    """The benchmark's evaluate_review: best match per golden comment, the rest of the candidates are FPs."""
    if not candidates:
        return {"skipped": False, "true_positives": [], "false_positives": [],
                "false_negatives": [{"golden_comment": g["comment"], "severity": g.get("severity"), "category": g.get("category")} for g in golden],
                "errors": [], "total_candidates": 0, "total_golden": len(golden), "tp": 0, "fp": 0, "fn": len(golden), "errors_count": 0,
                "precision": 0.0, "recall": 0.0}
    pairs = [(g, c) for g in golden for c in candidates]
    verdicts = list(pool.map(lambda gc: ask(template.format(golden_comment=gc[0]["comment"], candidate=gc[1]), model), pairs))
    best: dict = {g["comment"]: {"matched": False, "confidence": 0.0, "candidate": None, "reasoning": None} for g in golden}
    matched = dict.fromkeys(range(len(candidates)), False)
    siblings: dict = {}
    for group in groups or []:
        for i in group:
            siblings[i] = set(group) - {i}
    errors = []
    for (g, c), v in zip(pairs, verdicts):
        if v.get("error"):
            errors.append({"golden": g["comment"], "candidate": c, "error": v["error"]})
            continue
        b = best[g["comment"]]
        if v["match"] and v["confidence"] > b["confidence"]:
            b.update(matched=True, confidence=v["confidence"], candidate=c, reasoning=v.get("reasoning"))
            i = candidates.index(c)
            matched[i] = True
            for s in siblings.get(i, ()):
                matched[s] = True
    tps = [{"golden_comment": g["comment"], "severity": g.get("severity"), "category": g.get("category"),
            "matched_candidate": best[g["comment"]]["candidate"], "confidence": best[g["comment"]]["confidence"],
            "reasoning": best[g["comment"]]["reasoning"]} for g in golden if best[g["comment"]]["matched"]]
    fns = [{"golden_comment": g["comment"], "severity": g.get("severity"), "category": g.get("category")}
           for g in golden if not best[g["comment"]]["matched"]]
    fps = [{"candidate": candidates[i]} for i, m in matched.items() if not m]
    return {"skipped": False, "true_positives": tps, "false_positives": fps, "false_negatives": fns, "errors": errors,
            "total_candidates": len(candidates), "total_golden": len(golden), "tp": len(tps), "fp": len(fps), "fn": len(fns),
            "errors_count": len(errors), "precision": len(tps) / len(candidates), "recall": len(tps) / len(golden) if golden else 0.0}


def candidates_of_run(run_dir: Path, tier: str) -> dict:
    """url → candidate texts of our findings: the title and the description, one per finding."""
    out = {}
    for path in sorted(run_dir.glob("*.json")):
        if path.name == "evaluations.json":
            continue
        with open(path, encoding="utf-8") as f:
            result = json.load(f)
        report = result.get("report")
        if not isinstance(report, dict):
            out[result["url"]] = None
            continue
        lists = [report.get("findings") or []]
        if tier == "all":
            lists += [report.get("advisory") or [], report.get("notes") or []]
        out[result["url"]] = [
            "\n".join(p for p in [(x.get("title") or "").strip(), (x.get("description") or "").strip()] if p)
            for lst in lists for x in lst if x.get("title")
        ]
    return out


def main() -> None:
    model = opt("--judge-model", "sonnet")
    tier = opt("--tier", "main")
    concurrency = opt("--concurrency", 8)
    baseline = opt("--baseline", "")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    golden = golden_by_url()
    template = judge_prompt()
    if baseline:
        tool, run_id = baseline, f"baseline-{baseline}"
        with open(BENCH / "results" / PUBLISHED_JUDGE_DIR / "candidates.json", encoding="utf-8") as f:
            published = json.load(f)
        try:
            with open(BENCH / "results" / PUBLISHED_JUDGE_DIR / "dedup_groups.json", encoding="utf-8") as f:
                dedup = json.load(f)
        except FileNotFoundError:
            dedup = {}
        cands = {url: [c["text"] for c in (published.get(url, {}).get(tool) or [])] for url in golden}
        groups = {url: (dedup.get(url, {}).get(tool) or None) for url in golden}
        missing = [url for url in golden if tool not in published.get(url, {})]
        if len(missing) == len(golden):
            sys.exit(f"no published candidates for tool {tool!r}")
    elif args:
        tool, run_id = TOOL, args[0]
        cands = candidates_of_run(MARTIAN_DIR / "results" / run_id, tier)
        groups = {}
    else:
        sys.exit(__doc__)
    out_dir = MARTIAN_DIR / "results" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    evaluations: dict = {}
    calls = 0
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for n, (url, g) in enumerate(golden.items(), 1):
            c = cands.get(url)
            if c is None:
                evaluations[url] = {tool: {"skipped": True, "reason": "no review result"}}
                print(f"[{n}/{len(golden)}] {url.split('github.com/')[1]}: no result")
                continue
            calls += len(g["comments"]) * len(c)
            ev = evaluate(g["comments"], c, groups.get(url), model, template, pool)
            evaluations[url] = {tool: ev}
            print(f"[{n}/{len(golden)}] {url.split('github.com/')[1]}: {len(c)} candidate(s), TP {ev['tp']} FP {ev['fp']} FN {ev['fn']}" + (f", {ev['errors_count']} judge error(s)" if ev.get("errors_count") else ""))
    meta = {"judge_model": model, "tier": tier, "tool": tool, "judge_calls": calls,
            "golden_sha256": (MARTIAN_DIR / "golden.sha256").read_text(encoding="utf-8") if (MARTIAN_DIR / "golden.sha256").exists() else None,
            "benchmark_commit": subprocess.run(["git", "-C", str(MARTIAN_DIR / "bench"), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()}
    with open(out_dir / "evaluations.json", "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "evaluations": evaluations}, f, indent=1)
    print(f"judged {calls} pair(s) with {model}; evaluations in {out_dir / 'evaluations.json'}")


if __name__ == "__main__":
    main()
