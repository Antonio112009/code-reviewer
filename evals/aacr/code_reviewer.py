"""code-reviewer reviewer for the AACR-Bench harness (installed as evaluation/reviewers/code_reviewer.py).

Runs `code-reviewer review --base <base> --head <head>` on the checked-out repository and stores the run's
report.json (kept findings, rejected findings, usage, cost) as the harness's per-instance result file.

Environment:
  CODE_REVIEWER_CLI    path to code-reviewer's dist/cli.js (required)
  CODE_REVIEWER_ARGS   extra CLI arguments, space-separated (e.g. "--full --model sonnet")
"""
from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import config
from repo_utils import clean_worktree, log, prepare_repo, run_command
from schema import ReviewInstance


def cli_path() -> str:
    path = os.getenv("CODE_REVIEWER_CLI", "")
    if not path or not Path(path).is_file():
        raise SystemExit("Set CODE_REVIEWER_CLI to code-reviewer's dist/cli.js.")
    return path


def ensure_installed() -> None:
    result = run_command(["node", cli_path(), "-v"])
    if result.returncode != 0:
        raise SystemExit(f"code-reviewer CLI failed: {result.stderr.strip()}")
    log(f"code-reviewer {result.stdout.strip()} (args: {os.getenv('CODE_REVIEWER_ARGS', '')})")


def _latest_run_dir(repo_path: Path) -> Optional[Path]:
    runs = repo_path / ".code-reviewer" / "runs"
    if not runs.is_dir():
        return None
    dirs = [d for d in runs.iterdir() if d.is_dir()]
    return max(dirs, key=lambda d: d.stat().st_mtime) if dirs else None


def review_instance(
    instance: ReviewInstance,
    repo_dir: Path,
    results_dir: Path,
    timeout_minutes: int = 60,
    preview: bool = False,
) -> Dict[str, Any]:
    log(f"=== [code-reviewer] Processing {instance.instance_id} ===")
    repo_path = prepare_repo(
        repo_dir=repo_dir,
        clone_url=instance.resolved_clone_url,
        repo_full_name=instance.repo,
        base_commit=instance.base_commit,
        head_commit=instance.head_commit,
    )

    out_dir = Path(tempfile.mkdtemp(prefix="cr-report-"))
    command = [
        "node",
        cli_path(),
        "-C",
        str(repo_path),
        "review",
        "--base",
        instance.base_commit,
        "--head",
        instance.head_commit,
        "--offline",
        "--no-authors",
        # Like `code-reviewer eval`: a benchmark never reuses cached answers, so cost and time are real.
        "--no-cache",
        "--plain",
        "-y",
        "--format",
        "json",
        "--out",
        str(out_dir),
        *shlex.split(os.getenv("CODE_REVIEWER_ARGS", "")),
    ]
    if preview:
        command.append("--dry-run")

    started_at = datetime.now(timezone.utc).isoformat()
    start = time.monotonic()
    try:
        process = run_command(command, cwd=repo_path, timeout_seconds=timeout_minutes * 60)
        exit_code, stderr = process.returncode, process.stderr
    except subprocess.TimeoutExpired:
        exit_code, stderr = -1, f"timeout after {timeout_minutes} min"
    duration = time.monotonic() - start

    report: Any = None
    report_file = out_dir / "report.json"
    if report_file.is_file():
        with report_file.open("r", encoding="utf-8") as handle:
            report = json.load(handle)

    results_dir.mkdir(parents=True, exist_ok=True)
    # Keep the whole run (prompts, replies, run.log) for analysis: clean_worktree deletes it from the checkout.
    run_dir = _latest_run_dir(repo_path)
    if run_dir is not None:
        target = results_dir / "runs" / instance.instance_id.replace("/", "__")
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(run_dir, target)
    shutil.rmtree(out_dir, ignore_errors=True)

    out_path = config.result_path(results_dir, instance.instance_id)
    payload = {
        "instance_id": instance.instance_id,
        "repo": instance.repo,
        "base_commit": instance.base_commit,
        "head_commit": instance.head_commit,
        "reviewer": "code-reviewer",
        "started_at": started_at,
        "duration_seconds": round(duration, 2),
        "exit_code": exit_code,
        "args": os.getenv("CODE_REVIEWER_ARGS", ""),
        "report": report,
        "stderr": (stderr or "")[-20000:],
    }
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    clean_worktree(repo_path)
    status = "ok" if report is not None else "failed"
    log(f"--- [code-reviewer] {instance.instance_id} {status} (exit={exit_code}, {duration:.0f}s) -> {out_path}")
    return {
        "instance_id": instance.instance_id,
        "status": status,
        "exit_code": exit_code,
        "result_path": str(out_path),
    }
