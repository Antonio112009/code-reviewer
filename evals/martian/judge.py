#!/usr/bin/env python3
"""Judges a run (or a published tool's candidates) against the golden comments with the benchmark's own prompt.

    judge.py <run-id> [--tier main|all] [--judge-model sonnet] [--effort low|medium|high] [--no-thinking]
             [--concurrency 8] [--backend api|cli]
    judge.py --baseline <tool> [--judge-model sonnet] [--no-thinking]    e.g. --baseline claude-code

`--judge-model claude-opus-4-5-20251101 --no-thinking` asks the leaderboard's judge model the way the
leaderboard does (its prompt and system message, no extended thinking). Through `claude -p`, which cannot set
the leaderboard's temperature of 0, it is still stricter than the published scores: published tools'
candidates re-judged with `--baseline` lose 1.6 to 5.4 F1 points (BENCHMARKS.md, "Judge calibration"). Compare
runs with re-judged baselines, not with the published table. Sonnet (the default) is cheaper and stricter.

The judge is called through the Anthropic Messages API with ANTHROPIC_API_KEY (from the environment or the macOS
Keychain), metered API spend; `--backend cli` uses `claude -p` (a Claude Code subscription) instead. Both send
the same prompt, system message and settings, so cached verdicts serve either.

The judge prompt and its system message are read verbatim from the pinned benchmark checkout
(offline/code_review_benchmark/step3_judge_comments.py, MIT) and answered by the judge model; every (golden,
candidate) pair of a pull request is judged, and the matching rule is the benchmark's: a golden comment is
matched by the candidate the judge is most confident about, a candidate counts as matched when it is that best
match for some golden comment, the rest are false positives. Verdicts are cached under
$MARTIAN_DIR/judge-cache by judge model, judge settings and texts.

What differs from the published pipeline: our candidates are the findings themselves (title and description,
one per finding; `--tier all` adds "worth a look" and maintainability notes), not issues an LLM extracted from
comment bodies, and there is no LLM de-duplication step. A published tool's candidates (`--baseline`) are
taken as checked in, with their de-duplication groups, so the two are comparable under this judge.

Output: $MARTIAN_DIR/results/<run-id>/eval-<judge>-<tier>.json (<judge>: the model, then -<effort> and
-nothink when set) in the benchmark's shape ({url: {tool: {tp, fp, fn, true_positives, false_negatives,
false_positives, ...}}}) plus judge metadata; report.py scores it.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MARTIAN_DIR = Path(os.environ.get("MARTIAN_DIR", os.path.expanduser("~/.cache/code-reviewer-martian")))
# The verdict cache; MARTIAN_JUDGE_CACHE points a calibration run at an empty one (the key has no backend in it).
JUDGE_CACHE = Path(os.environ.get("MARTIAN_JUDGE_CACHE", MARTIAN_DIR / "judge-cache"))
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


def judge_prompts() -> tuple[str, str]:
    """The benchmark's judge prompt and system message, verbatim from its step3 script."""
    src = (BENCH / "code_review_benchmark" / "step3_judge_comments.py").read_text(encoding="utf-8")
    m = re.search(r'JUDGE_PROMPT = """(.*?)"""', src, re.S)
    s = re.search(r'"role": "system",\s*"content": "([^"]+)"', src)
    if not m or not s:
        sys.exit("the judge prompt was not found in the benchmark checkout: run evals/martian/setup.sh")
    return m.group(1), s.group(1)


SYSTEM = ""  # set from the benchmark checkout in main()
BACKEND = "api"  # set from --backend in main()
# `claude -p` model aliases, as the API's model ids.
API_MODELS = {"sonnet": "claude-sonnet-5-5", "opus": "claude-opus-5-5", "haiku": "claude-haiku-5-5"}
# USD per million tokens (input, output), for the cost line.
API_PRICES = {
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-haiku-5-5": (0.1, 0.5),
    "claude-opus-4-5-20251101": (5.0, 25.0),
}
_api_key = ""


def api_key() -> str:
    global _api_key
    if not _api_key:
        _api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip() or subprocess.run(
            ["security", "find-generic-password", "-a", os.environ.get("USER", ""), "-s", "ANTHROPIC_API_KEY", "-w"],
            capture_output=True, text=True,
        ).stdout.strip()
        if not _api_key:
            sys.exit("Set ANTHROPIC_API_KEY (or pass --backend cli) for the judge.")
    return _api_key


def ask_api(prompt: str, model: str, effort: str, thinking: bool) -> tuple[str, float]:
    """One judge call through the Messages API: the reply text and its cost. Models before Claude 4.6 run
    without thinking unless asked; on later models thinking cannot be turned off, so `--no-thinking` only
    applies to the former (the leaderboard's Opus 4.5)."""
    api_model = API_MODELS.get(model, model)
    body: dict = {"model": api_model, "max_tokens": 4096, "system": SYSTEM,
                  "messages": [{"role": "user", "content": prompt}]}
    if effort:
        body["output_config"] = {"effort": effort}
    if thinking and api_model in ("claude-opus-4-5-20251101",):
        body["thinking"] = {"type": "enabled", "budget_tokens": 2048}
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
        headers={"x-api-key": api_key(), "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=180) as res:
                data = json.load(res)
            break
        except urllib.error.HTTPError as err:
            if err.code != 429 and err.code < 500:
                raise ValueError(f"HTTP {err.code}: {err.read()[:200]!r}") from err
            time.sleep(5 * (attempt + 1))
    else:
        raise ValueError("the judge API kept failing")
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage") or {}
    price_in, price_out = API_PRICES.get(api_model, (0.0, 0.0))
    return text, (usage.get("input_tokens", 0) * price_in + usage.get("output_tokens", 0) * price_out) / 1e6


def ask(prompt: str, model: str, effort: str = "", thinking: bool = True) -> dict:
    """One judge call (Messages API, or `claude -p`); the answer is the JSON object the prompt asks for."""
    variant = f"{'@' + effort if effort else ''}{'' if thinking else '@nothink'}@{SYSTEM}"
    key = hashlib.sha256(f"{model}{variant}\n{prompt}".encode()).hexdigest()
    cached = JUDGE_CACHE / f"{key}.json"
    if cached.exists():
        with open(cached, encoding="utf-8") as f:
            return json.load(f)
    command = [
        "claude", "-p", "--model", model, "--output-format", "json",
        "--system-prompt", SYSTEM,
        "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence",
        *(["--effort", effort] if effort else []),
    ]
    last = ""
    for attempt in range(3):
        try:
            if BACKEND == "api":
                text, cost = ask_api(prompt, model, effort, thinking)
                data = {"total_cost_usd": cost}
            else:
                env = os.environ if thinking else {**os.environ, "MAX_THINKING_TOKENS": "0"}
                proc = subprocess.run(command, input=prompt, capture_output=True, text=True, timeout=120, env=env)
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
             pool: ThreadPoolExecutor, effort: str = "", thinking: bool = True) -> dict:
    """The benchmark's evaluate_review: best match per golden comment, the rest of the candidates are FPs."""
    if not candidates:
        return {"skipped": False, "true_positives": [], "false_positives": [],
                "false_negatives": [{"golden_comment": g["comment"], "severity": g.get("severity"), "category": g.get("category")} for g in golden],
                "errors": [], "total_candidates": 0, "total_golden": len(golden), "tp": 0, "fp": 0, "fn": len(golden), "errors_count": 0,
                "precision": 0.0, "recall": 0.0}
    pairs = [(g, c) for g in golden for c in candidates]
    verdicts = list(pool.map(lambda gc: ask(template.format(golden_comment=gc[0]["comment"], candidate=gc[1]), model, effort, thinking), pairs))
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
        if path.name.startswith("eval") or path.name == "provenance.json":
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
    effort = opt("--effort", "")
    thinking = "--no-thinking" not in sys.argv
    tier = opt("--tier", "main")
    concurrency = opt("--concurrency", 8)
    baseline = opt("--baseline", "")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    global SYSTEM, BACKEND
    BACKEND = opt("--backend", "api")
    if BACKEND not in ("api", "cli"):
        sys.exit("--backend must be api or cli")
    golden = golden_by_url()
    template, SYSTEM = judge_prompts()
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
            ev = evaluate(g["comments"], c, groups.get(url), model, template, pool, effort, thinking)
            evaluations[url] = {tool: ev}
            print(f"[{n}/{len(golden)}] {url.split('github.com/')[1]}: {len(c)} candidate(s), TP {ev['tp']} FP {ev['fp']} FN {ev['fn']}" + (f", {ev['errors_count']} judge error(s)" if ev.get("errors_count") else ""))
    meta = {"judge_model": model, "judge_effort": effort or "default", "judge_thinking": thinking, "tier": tier,
            "tool": tool, "judge_calls": calls,
            "golden_sha256": (MARTIAN_DIR / "golden.sha256").read_text(encoding="utf-8") if (MARTIAN_DIR / "golden.sha256").exists() else None,
            "benchmark_commit": subprocess.run(["git", "-C", str(MARTIAN_DIR / "bench"), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()}
    out = out_dir / f"eval-{model}{'-' + effort if effort else ''}{'' if thinking else '-nothink'}-{tier}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "evaluations": evaluations}, f, indent=1)
    print(f"judged {calls} pair(s) with {model}; evaluations in {out}")


if __name__ == "__main__":
    main()
