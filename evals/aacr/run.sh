#!/usr/bin/env bash
# Runs a reviewer on AACR-Bench and scores it. Run setup.sh first.
#
#   evals/aacr/run.sh <run-id> [--pilot] [--stage all|review|eval] [--limit N] [--concurrency N]
#                     [--reviewer code-reviewer|claude|codex|ocr] [-- <code-reviewer arguments>]
#
# code-reviewer arguments default to "--full". Results: $AACR_DIR/aacr-bench/evaluation/results/<dataset>/
# <reviewer>/<run-id>/, metrics next to them under metrics/. Cloned repositories are shared in $AACR_DIR/repos.
set -euo pipefail

AACR_DIR=${AACR_DIR:-$HOME/.cache/code-reviewer-aacr}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
EVAL=$AACR_DIR/aacr-bench/evaluation

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

[ $# -ge 1 ] || usage 1
case $1 in -h | --help) usage ;; -*) usage 1 ;; esac
RUN_ID=$1
shift
DATASET=data/aacr_bench.jsonl
STAGE=all
REVIEWER=code-reviewer
EXTRA=()
CR_ARGS=(--full)
while [ $# -gt 0 ]; do
  case $1 in
    --pilot) DATASET=data/aacr_pilot.jsonl ;;
    --stage) STAGE=$2; shift ;;
    --limit | --concurrency) EXTRA+=("$1" "$2"); shift ;;
    --reviewer) REVIEWER=$2; shift ;;
    --) shift; CR_ARGS=("$@"); break ;;
    -h | --help) usage ;;
    *) echo "unknown option: $1" >&2; usage 1 ;;
  esac
  shift
done

[ -d "$EVAL/.venv" ] || { echo "Run evals/aacr/setup.sh first." >&2; exit 1; }

# The benchmark measures whatever dist/ contains: build first (or point CODE_REVIEWER_CLI at another build).
export CODE_REVIEWER_CLI=${CODE_REVIEWER_CLI:-$ROOT/dist/cli.js}
export CODE_REVIEWER_ARGS="${CR_ARGS[*]}"
[ -f "$CODE_REVIEWER_CLI" ] || { echo "$CODE_REVIEWER_CLI not found: npm run build" >&2; exit 1; }

# Without an OpenAI-compatible judge endpoint (JUDGE_API_KEY), `claude -p` judges with the harness's prompt.
if [ -z "${JUDGE_API_KEY:-}" ]; then
  export JUDGE_BACKEND=claude-cli JUDGE_CLAUDE_MODEL=${JUDGE_CLAUDE_MODEL:-sonnet}
fi
# The harness's Claude Code reviewer: use the logged-in account unless a gateway token is configured.
if [ "$REVIEWER" = claude ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  export CLAUDE_USE_SUBSCRIPTION=true ANTHROPIC_MODEL=${ANTHROPIC_MODEL:-sonnet}
fi

cd "$EVAL"
exec .venv/bin/python -m pipeline run --stage "$STAGE" --reviewer "$REVIEWER" --dataset "$DATASET" \
  --run-id "$RUN_ID" --repo-dir "$AACR_DIR/repos" --timeout-minutes 60 ${EXTRA[@]+"${EXTRA[@]}"}
