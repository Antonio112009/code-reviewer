#!/usr/bin/env bash
# Prepares Martian's Code Review Bench (github.com/withmartian/code-review-benchmark, MIT) for an offline run of
# code-reviewer: the benchmark's `offline/` directory at a pinned commit (golden comments, judge prompt, the
# published tools' candidates and verdicts), five blobless clones of the reviewed repositories, and every
# pull request's base and head commits (prs.json). Safe to re-run.
#
#   MARTIAN_DIR=~/.cache/code-reviewer-martian evals/martian/setup.sh
set -euo pipefail

MARTIAN_PIN=e616e849755441da38f18bf3adba2c9583b03803
MARTIAN_DIR=${MARTIAN_DIR:-$HOME/.cache/code-reviewer-martian}
HERE=$(cd "$(dirname "$0")" && pwd)
BENCH=$MARTIAN_DIR/bench

mkdir -p "$MARTIAN_DIR/repos" "$MARTIAN_DIR/results" "$MARTIAN_DIR/judge-cache"
if [ ! -d "$BENCH/.git" ]; then
  git clone -q --filter=blob:none --no-checkout https://github.com/withmartian/code-review-benchmark.git "$BENCH"
  git -C "$BENCH" sparse-checkout set offline
fi
git -C "$BENCH" fetch -q origin "$MARTIAN_PIN" 2>/dev/null || true
git -C "$BENCH" checkout -q -f "$MARTIAN_PIN"
# The golden set has no version of its own: every result records this hash.
(cd "$BENCH/offline/golden_comments" && shasum -a 256 *.json) > "$MARTIAN_DIR/golden.sha256"

python3 - "$HERE/prs.json" "$MARTIAN_DIR/repos" <<'PY'
import json, subprocess, sys

manifest, repos = json.load(open(sys.argv[1])), sys.argv[2]

def git(repo, *args, check=True):
    return subprocess.run(["git", "-C", repo, *args], check=check, capture_output=True, text=True)

def has(repo, sha):
    return git(repo, "cat-file", "-e", f"{sha}^{{commit}}", check=False).returncode == 0

for clone, name in sorted({(p["clone"], p["repo"]) for p in manifest}):
    path = f"{repos}/{name}"
    try:
        git(path, "rev-parse", "--git-dir")
    except (FileNotFoundError, subprocess.CalledProcessError):
        print(f"cloning {clone} (blobless, no checkout)")
        subprocess.run(["git", "clone", "-q", "--filter=blob:none", "--no-checkout", clone, path], check=True)

failed = 0
for pr in manifest:
    path = f"{repos}/{pr['repo']}"
    if not (has(path, pr["head"]) and has(path, pr["base"])):
        # The pull request's own host (upstream or a benchmark mirror) has both commits.
        spec = [pr["base"], f"+{pr['fetch']['ref']}:refs/bench/{pr['id']}", pr["head"]]
        r = git(path, "fetch", "-q", pr["fetch"]["url"], *spec, check=False)
        if r.returncode != 0:
            failed += 1
            print(f"{pr['id']}: fetch failed: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else r.returncode}")
            continue
    mb = git(path, "merge-base", pr["base"], pr["head"]).stdout.strip()
    if mb != pr["mergeBase"]:
        failed += 1
        print(f"{pr['id']}: merge-base {mb[:12]} differs from the manifest's {pr['mergeBase'][:12]}")
print(f"{len(manifest) - failed} of {len(manifest)} pull requests ready" + (f", {failed} failed" if failed else ""))
sys.exit(1 if failed else 0)
PY

echo "Martian benchmark ready in $MARTIAN_DIR"
