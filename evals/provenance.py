"""Records how a benchmark run was made, next to its results: which Code Reviewer build (version and commit),
the exact arguments and experiment switches, the judge, the benchmark checkout. BENCHMARKS.md cites these files.

    evals/provenance.py review <run-dir> --benchmark <name> --run-id <id> [--reviewer code-reviewer]
    evals/provenance.py judge <run-dir> --benchmark <name>

`review` writes <run-dir>/provenance.json from the environment of the run (CODE_REVIEWER_CLI, CODE_REVIEWER_ARGS,
CR_EXP); `judge` appends a judging (JUDGE_BACKEND, JUDGE_CLAUDE_MODEL / JUDGE_MODEL, EVAL_ROUNDS). The build's commit
comes from BUILD.json next to dist/ (written by evals/pin-build.sh), else from the git checkout the CLI lives in
(with a dirty flag). API keys and tokens are never read or written.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run(*cmd: str, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, timeout=60).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def build_info(cli: str) -> dict:
    """Version and commit of the Code Reviewer build a run used."""
    if not cli:
        return {}
    build_dir = Path(cli).resolve().parent.parent
    info: dict = {"cli": str(cli), "version": _run("node", cli, "--version")}
    pinned = build_dir / "BUILD.json"
    if pinned.is_file():
        with open(pinned, encoding="utf-8") as f:
            info["build"] = json.load(f)
    elif _run("git", "-C", str(build_dir), "rev-parse", "--is-inside-work-tree") == "true":
        info["build"] = {
            "commit": _run("git", "-C", str(build_dir), "rev-parse", "HEAD"),
            "describe": _run("git", "-C", str(build_dir), "describe", "--tags", "--always", "--dirty"),
            "dirty": bool(_run("git", "-C", str(build_dir), "status", "--porcelain", "--untracked-files=no")),
        }
    else:
        info["build"] = {"commit": None, "note": "no BUILD.json and not a git checkout: pin builds with evals/pin-build.sh"}
    return info


def judge_info() -> dict:
    backend = os.environ.get("JUDGE_BACKEND") or ("openai-compatible" if os.environ.get("JUDGE_API_KEY") else "")
    model = os.environ.get("JUDGE_CLAUDE_MODEL") if backend == "claude-cli" else os.environ.get("JUDGE_MODEL")
    out = {"backend": backend, "model": model, "rounds": int(os.environ.get("EVAL_ROUNDS", "1") or 1)}
    if backend == "claude-cli":
        out["claude_cli"] = _run("claude", "--version")
    return out


def benchmark_info(name: str) -> dict:
    if name.startswith("aacr"):
        harness = Path(os.environ.get("AACR_DIR", os.path.expanduser("~/.cache/code-reviewer-aacr"))) / "aacr-bench"
        patch = ROOT / "evals" / "aacr" / "harness.patch"
        return {"benchmark": name, "harness_commit": _run("git", "-C", str(harness), "rev-parse", "HEAD"),
                "harness_patch_sha256": hashlib.sha256(patch.read_bytes()).hexdigest() if patch.is_file() else None}
    if name.startswith("martian"):
        bench = Path(os.environ.get("MARTIAN_DIR", os.path.expanduser("~/.cache/code-reviewer-martian"))) / "bench"
        return {"benchmark": name, "benchmark_commit": _run("git", "-C", str(bench), "rev-parse", "HEAD")}
    return {"benchmark": name}


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[1] not in ("review", "judge"):
        sys.exit(__doc__)
    stage, run_dir = sys.argv[1], Path(sys.argv[2])
    opt = lambda name, default="": sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default  # noqa: E731
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / "provenance.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if stage == "review":
        data = {
            "run_id": opt("--run-id", run_dir.name),
            "reviewer": opt("--reviewer", "code-reviewer"),
            "created_at": now,
            **benchmark_info(opt("--benchmark")),
            "code_reviewer": build_info(os.environ.get("CODE_REVIEWER_CLI", "")),
            "args": os.environ.get("CODE_REVIEWER_ARGS", ""),
            "experiment_env": {k: v for k, v in os.environ.items() if k == "CR_EXP" or k.startswith("CR_EXP_")},
            "judgings": data.get("judgings", []),
        }
    else:
        data.setdefault("judgings", []).append({"at": now, **judge_info()})
    path.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
