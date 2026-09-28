#!/usr/bin/env bash
# Prepares the AACR-Bench harness (github.com/alibaba/aacr-bench, Apache-2.0) with code-reviewer as a reviewer:
# clones it at a pinned commit into $AACR_DIR, applies harness.patch, installs the reviewer adapter, creates the
# Python environment and converts the dataset (all PRs, and the 10-PR pilot subset). Safe to re-run: it resets
# the harness's tracked files and applies the patch again.
set -euo pipefail

AACR_PIN=68a569759289a83654a59d06db2a72910edf0a4a
AACR_DIR=${AACR_DIR:-$HOME/.cache/code-reviewer-aacr}
HERE=$(cd "$(dirname "$0")" && pwd)
HARNESS=$AACR_DIR/aacr-bench
EVAL=$HARNESS/evaluation

command -v uv >/dev/null || { echo "uv is required: https://docs.astral.sh/uv/" >&2; exit 1; }

mkdir -p "$AACR_DIR"
if [ ! -d "$HARNESS/.git" ]; then
  git clone -q https://github.com/alibaba/aacr-bench.git "$HARNESS"
fi
git -C "$HARNESS" fetch -q origin "$AACR_PIN" 2>/dev/null || true
git -C "$HARNESS" checkout -q -f "$AACR_PIN"
git -C "$HARNESS" apply "$HERE/harness.patch"
cp "$HERE/code_reviewer.py" "$EVAL/reviewers/code_reviewer.py"

cd "$EVAL"
[ -x .venv/bin/python ] || uv venv -q .venv --python 3.11
uv pip install -q -r requirements.txt --python .venv/bin/python

# The raw data ships in the repository (dataset/positive_samples.json); the converter keeps its order
# unless --limit is given, which shuffles with --seed. Seed 42 is the pilot subset in README.md.
.venv/bin/python -m converters.aacr_bench --input ../dataset/positive_samples.json \
  --output data/aacr_bench.jsonl --validate
.venv/bin/python -m converters.aacr_bench --input ../dataset/positive_samples.json \
  --output data/aacr_pilot.jsonl --limit 10 --seed 42 --validate

echo "AACR-Bench harness ready in $EVAL"
