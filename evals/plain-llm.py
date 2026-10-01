#!/usr/bin/env python3
"""The plain-LLM baseline: the reviewer's own model asked once to review the pull request's diff. No skills, no
chunking, no repository tools, no critic, no thresholds. It answers one question: what does Code Reviewer's
pipeline add over just asking the same model?

    evals/plain-llm.py martian <run-id> [--limit N] [--concurrency 4] [--model sonnet] [--effort medium]
    evals/plain-llm.py aacr <run-id> --subset ctx30|holda|holdb|hold82 [--concurrency 4] [--model ...] [--effort ...]

Martian: writes $MARTIAN_DIR/results/<run-id>/<id>.json; judge with `evals/martian/judge.py <run-id>`.
AACR: writes the code-reviewer result shape under $AACR_DIR/aacr-bench/evaluation/results/aacr_<subset>/
code-reviewer/<run-id>/; judge with `evals/aacr/run.sh <run-id> --subset <subset> --stage eval`.

What the model gets: the pull request's own changes (`git diff -U5 <merge-base> <head>`, as Code Reviewer
reviews them), each line prefixed with its line number in the new version so the model can point at lines;
lockfiles left out; diffs over 600,000 characters cut (recorded per pull request). One call per pull request:
`claude -p --model <model> --effort <effort> --tools ""` from an empty directory, with no settings, memory or
MCP servers. The defaults match the reviewer's routing in 0.7.0 (Sonnet, medium effort).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
MARTIAN_DIR = Path(os.environ.get("MARTIAN_DIR", os.path.expanduser("~/.cache/code-reviewer-martian")))
AACR_DIR = Path(os.environ.get("AACR_DIR", os.path.expanduser("~/.cache/code-reviewer-aacr")))
MAX_DIFF_CHARS = 600_000
EXCLUDE = ["**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/*.lock", "**/go.sum"]
SYSTEM = "You are an expert software engineer reviewing a pull request."
PROMPT = """Review this pull request. Report the bugs, security problems and other real defects the change introduces.
For each one give the file, the line number in the new version of the file (the number at the start of each diff
line), a one-line title and a short explanation of what goes wrong. Reply with a JSON array only:
[{{"file": "path/to/file", "line": 123, "title": "...", "description": "..."}}]
If you find nothing, reply [].

{diff}"""


def opt(name: str, default):
    if name in sys.argv:
        value = sys.argv[sys.argv.index(name) + 1]
        return type(default)(value) if default is not None else value
    return default


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True,
                          errors="replace").stdout


def numbered_diff(repo: Path, merge_base: str, head: str) -> tuple[str, bool]:
    """The pull request's diff with new-version line numbers in front of context and added lines."""
    raw = git(repo, "diff", "--no-color", "--no-ext-diff", "-U5", merge_base, head, "--", ".",
              *[f":(exclude,glob){p}" for p in EXCLUDE])
    out: list[str] = []
    line_no: int | None = None
    for line in raw.splitlines():
        hunk = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if hunk:
            line_no = int(hunk.group(1))
            out.append(line)
        elif line.startswith("diff --git"):
            line_no = None
            out += ["", line]
        elif line_no is None or line.startswith(("+++ ", "--- ", "\\")):
            out.append(line)
        elif line.startswith("-"):
            out.append(f"       {line}")
        else:
            out.append(f"{line_no:6d} {line}")
            line_no += 1
    text = "\n".join(out)
    return (text[:MAX_DIFF_CHARS] + "\n[diff cut here]", True) if len(text) > MAX_DIFF_CHARS else (text, False)


def ask(diff: str, model: str, effort: str) -> dict:
    """One call; the reply's JSON array becomes findings."""
    cmd = ["claude", "-p", "--model", model, "--effort", effort, "--output-format", "json", "--system-prompt", SYSTEM,
           "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence"]
    last = ""
    with tempfile.TemporaryDirectory(prefix="plain-llm-") as empty:
        for _ in range(2):
            try:
                proc = subprocess.run(cmd, input=PROMPT.format(diff=diff), capture_output=True, text=True,
                                      timeout=900, cwd=empty)
                data = json.loads(proc.stdout)
                if data.get("is_error"):
                    raise ValueError(str(data.get("result"))[:200])
                text = str(data.get("result", ""))
                m = re.search(r"\[.*\]", text, re.S)
                items = json.loads(m.group(0)) if m else []
                if not isinstance(items, list):
                    raise ValueError("reply is not a JSON array")
                return {"items": items, "cost": data.get("total_cost_usd"), "usage": data.get("usage") or {},
                        "models": list((data.get("modelUsage") or {}).keys())}
            except Exception as err:  # noqa: BLE001
                last = str(err)[:300]
    return {"items": [], "error": last}


def to_report(answer: dict) -> dict:
    findings = []
    for x in answer.get("items") or []:
        if not isinstance(x, dict) or not x.get("title"):
            continue
        try:
            line = int(x.get("line") or 1)
        except (TypeError, ValueError):
            line = 1
        findings.append({"file": str(x.get("file") or ""), "startLine": line, "endLine": line,
                         "title": str(x["title"]), "description": str(x.get("description") or "")})
    u = answer.get("usage") or {}
    return {
        "findings": findings,
        "usage": {"inputTokens": u.get("input_tokens", 0), "cachedInputTokens": u.get("cache_read_input_tokens", 0),
                  "cacheWriteTokens": u.get("cache_creation_input_tokens", 0), "outputTokens": u.get("output_tokens", 0)},
        **({"cost": {"amount": answer["cost"], "currency": "USD"}} if answer.get("cost") else {}),
    }


def provenance(run_dir: Path, model: str, effort: str, extra: dict) -> None:
    claude = subprocess.run(["claude", "--version"], capture_output=True, text=True).stdout.strip()
    with open(run_dir / "provenance.json", "w", encoding="utf-8") as f:
        json.dump({"reviewer": "plain-llm", "model": model, "effort": effort, "claude_cli": claude,
                   "prompt_sha256": hashlib.sha256((SYSTEM + PROMPT).encode()).hexdigest(),
                   "diff": f"merge-base..head, -U5, numbered, lockfiles excluded, cut at {MAX_DIFF_CHARS} chars",
                   "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **extra}, f, indent=1)


def run(jobs: list[dict], run_dir: Path, model: str, effort: str, concurrency: int, write) -> None:
    todo = [j for j in jobs if not (run_dir / j["file"]).exists()]
    print(f"{run_dir.name}: {len(todo)} of {len(jobs)} pull request(s), model {model}, effort {effort}")
    done = 0

    def one(job: dict) -> dict:
        started = time.time()
        try:
            diff, cut = numbered_diff(job["repo"], job["mergeBase"], job["head"])
        except subprocess.CalledProcessError as err:
            return {"job": job, "error": f"git: {err.stderr.strip()[:200]}", "seconds": 0}
        answer = ask(diff, model, effort)
        return {"job": job, "answer": answer, "cut": cut, "seconds": round(time.time() - started, 1)}

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for fut in as_completed([pool.submit(one, j) for j in todo]):
            r = fut.result()
            done += 1
            write(r)
            a = r.get("answer") or {}
            status = r.get("error") or a.get("error") or f"{len(a.get('items') or [])} finding(s)"
            print(f"[{done}/{len(todo)}] {r['job']['label']}: {status}, {r['seconds']:.0f}s"
                  + (f", ${a['cost']:.3f}" if a.get("cost") else "") + (", diff cut" if r.get("cut") else ""))


def martian(run_id: str, model: str, effort: str, concurrency: int) -> None:
    with open(HERE / "martian" / "prs.json", encoding="utf-8") as f:
        manifest = json.load(f)
    if opt("--limit", 0):
        manifest = manifest[: opt("--limit", 0)]
    run_dir = MARTIAN_DIR / "results" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    provenance(run_dir, model, effort, {"benchmark": "martian"})
    jobs = [{**p, "label": p["id"], "file": f"{p['id']}.json", "repo": MARTIAN_DIR / "repos" / p["repo"]} for p in manifest]

    def write(r: dict) -> None:
        j, a = r["job"], r.get("answer") or {}
        result = {"id": j["id"], "url": j["url"], "set": j["set"], "base": j["base"], "head": j["head"],
                  "mergeBase": j["mergeBase"], "args": f"plain-llm --model {model} --effort {effort}",
                  "exit_code": 0 if not (r.get("error") or a.get("error")) else 1,
                  "stderr": r.get("error") or a.get("error") or "", "diff_cut": r.get("cut", False),
                  "duration_seconds": r["seconds"], **({"report": to_report(a)} if a else {})}
        with open(run_dir / j["file"], "w", encoding="utf-8") as f:
            json.dump(result, f)

    run(jobs, run_dir, model, effort, concurrency, write)


def aacr(run_id: str, subset: str, model: str, effort: str, concurrency: int) -> None:
    evaluation = AACR_DIR / "aacr-bench" / "evaluation"
    with open(evaluation / "data" / f"aacr_{subset}.jsonl", encoding="utf-8") as f:
        instances = [json.loads(line) for line in f if line.strip()]
    run_dir = evaluation / "results" / f"aacr_{subset}" / "code-reviewer" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    provenance(run_dir, model, effort, {"benchmark": f"aacr_{subset}"})
    jobs = []
    for x in instances:
        repo = AACR_DIR / "repos" / x["instance_id"].split("@")[0]
        try:
            mb = git(repo, "merge-base", x["base_commit"], x["head_commit"]).strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            print(f"{x['instance_id']}: commits not available locally, skipped")
            continue
        jobs.append({"label": x["instance_id"], "file": f"{x['instance_id']}.json", "repo": repo, "mergeBase": mb,
                     "head": x["head_commit"], "instance": x})

    def write(r: dict) -> None:
        j, a = r["job"], r.get("answer") or {}
        x = j["instance"]
        result = {"instance_id": x["instance_id"], "repo": x["repo"], "base_commit": x["base_commit"],
                  "head_commit": x["head_commit"], "reviewer": "code-reviewer",
                  "args": f"plain-llm --model {model} --effort {effort}",
                  "exit_code": 0 if not (r.get("error") or a.get("error")) else 1,
                  "stderr": r.get("error") or a.get("error") or "", "diff_cut": r.get("cut", False),
                  "duration_seconds": r["seconds"], **({"report": to_report(a)} if a else {})}
        with open(run_dir / j["file"], "w", encoding="utf-8") as f:
            json.dump(result, f)

    run(jobs, run_dir, model, effort, concurrency, write)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--") and sys.argv[sys.argv.index(a) - 1][:2] != "--"]
    if len(args) < 2 or args[0] not in ("martian", "aacr"):
        sys.exit(__doc__)
    model, effort, concurrency = opt("--model", "sonnet"), opt("--effort", "medium"), opt("--concurrency", 4)
    if args[0] == "martian":
        martian(args[1], model, effort, concurrency)
    else:
        subset = opt("--subset", "")
        if not subset:
            sys.exit("--subset is required for aacr")
        aacr(args[1], subset, model, effort, concurrency)
