"""Reviews the benchmark's pull requests with code-reviewer, one detached worktree at the head commit each.

    runner.py <run-id> [--limit N] [--concurrency N] [--timeout-minutes M] [--only <id,id,...>]

Environment: MARTIAN_DIR (default ~/.cache/code-reviewer-martian), CODE_REVIEWER_CLI (path of dist/cli.js),
CODE_REVIEWER_ARGS (extra arguments, e.g. "--full --deepen"). Results: $MARTIAN_DIR/results/<run-id>/<id>.json,
one per pull request, with the full report; a pull request with a result file is skipped (resume).

The reviewer sees only the worktree at the head commit and runs `--offline`: the clone's later history (which
contains the fixes of these bugs) is never fetched into it, and nothing is read from the network.
"""
from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

MARTIAN_DIR = Path(os.environ.get("MARTIAN_DIR", os.path.expanduser("~/.cache/code-reviewer-martian")))
HERE = Path(__file__).resolve().parent


def opt(name: str, default):
    if name in sys.argv:
        value = sys.argv[sys.argv.index(name) + 1]
        return type(default)(value) if default is not None else value
    return default


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def review(pr: dict, run_dir: Path, cli: str, args: list[str], timeout_s: int) -> dict:
    repo = MARTIAN_DIR / "repos" / pr["repo"]
    work = MARTIAN_DIR / "work" / run_dir.name / pr["id"]
    if work.exists():
        subprocess.run(["git", "-C", str(repo), "worktree", "remove", "--force", str(work)], capture_output=True)
        shutil.rmtree(work, ignore_errors=True)
    work.parent.mkdir(parents=True, exist_ok=True)
    git(repo, "worktree", "add", "--detach", "-q", str(work), pr["head"])
    out = Path(tempfile.mkdtemp(prefix="martian-report-"))
    started = time.time()
    cmd = [
        "node", cli, "-C", str(work), "review",
        "--base", pr["base"], "--head", pr["head"],
        "--offline", "--no-authors", "--no-cache", "--plain", "-y", "--format", "json", "--out", str(out),
        *args,
    ]
    result = {"id": pr["id"], "url": pr["url"], "set": pr["set"], "base": pr["base"], "head": pr["head"],
              "mergeBase": pr["mergeBase"], "args": " ".join(args), "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)
        result["exit_code"] = proc.returncode
        result["stderr"] = proc.stderr[-4000:]
        report = out / "report.json"
        if report.exists():
            with open(report, encoding="utf-8") as f:
                result["report"] = json.load(f)
    except subprocess.TimeoutExpired:
        result["exit_code"] = -1
        result["stderr"] = f"timed out after {timeout_s}s"
    finally:
        result["duration_seconds"] = round(time.time() - started, 1)
        shutil.rmtree(out, ignore_errors=True)
        subprocess.run(["git", "-C", str(repo), "worktree", "remove", "--force", str(work)], capture_output=True)
        subprocess.run(["git", "-C", str(repo), "worktree", "prune"], capture_output=True)
    return result


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    run_id = args[0]
    cli = os.environ.get("CODE_REVIEWER_CLI") or ""
    if not os.path.isfile(cli):
        sys.exit("CODE_REVIEWER_CLI must point at a built dist/cli.js")
    extra = shlex.split(os.environ.get("CODE_REVIEWER_ARGS", ""))
    limit, concurrency, timeout_min = opt("--limit", 0), opt("--concurrency", 3), opt("--timeout-minutes", 60)
    only = set((opt("--only", "") or "").split(",")) - {""}
    with open(HERE / "prs.json", encoding="utf-8") as f:
        manifest = json.load(f)
    if only:
        manifest = [p for p in manifest if p["id"] in only]
    if limit:
        manifest = manifest[:limit]
    run_dir = MARTIAN_DIR / "results" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    todo = [p for p in manifest if not (run_dir / f"{p['id']}.json").exists()]
    print(f"{run_id}: {len(todo)} of {len(manifest)} pull request(s) to review, concurrency {concurrency}, args: {' '.join(extra)}")
    done = 0
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(review, p, run_dir, cli, extra, timeout_min * 60): p for p in todo}
        for fut in as_completed(futures):
            pr = futures[fut]
            try:
                result = fut.result()
            except Exception as err:  # noqa: BLE001
                result = {"id": pr["id"], "url": pr["url"], "set": pr["set"], "exit_code": -2, "stderr": str(err)}
            with open(run_dir / f"{pr['id']}.json", "w", encoding="utf-8") as f:
                json.dump(result, f)
            done += 1
            report = result.get("report") or {}
            findings = len(report.get("findings") or [])
            advisory = len(report.get("advisory") or [])
            cost = (report.get("cost") or {}).get("amount")
            status = "ok" if result.get("exit_code") == 0 and report else f"exit {result.get('exit_code')}"
            print(f"[{done}/{len(todo)}] {pr['id']}: {status}, {findings} finding(s) + {advisory} worth a look, "
                  f"{result.get('duration_seconds', 0):.0f}s" + (f", ${cost:.2f}" if cost else ""))


if __name__ == "__main__":
    main()
