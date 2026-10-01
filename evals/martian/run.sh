#!/usr/bin/env bash
# Reviews the Martian benchmark's pull requests with code-reviewer, judges the findings and prints the scores.
# Run setup.sh first.
#
#   evals/martian/run.sh <run-id> [--stage all|review|judge] [--limit N] [--only id,id] [--concurrency N]
#                        [--tier main|all] [--judge-model sonnet|claude-opus-4-5-20251101] [--no-thinking]
#                        [-- <code-reviewer arguments>]
#
# The leaderboard's judge is --judge-model claude-opus-4-5-20251101 --no-thinking (Sonnet is for iterating).
# code-reviewer arguments default to "--full". Results: $MARTIAN_DIR/results/<run-id>/ (one file per pull
# request with the full report, then evaluations.json). The benchmark measures whatever CODE_REVIEWER_CLI
# (default dist/cli.js) contains.
set -euo pipefail

MARTIAN_DIR=${MARTIAN_DIR:-$HOME/.cache/code-reviewer-martian}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE=$ROOT/evals/martian

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

[ $# -ge 1 ] || usage 1
case $1 in -h | --help) usage ;; -*) usage 1 ;; esac
RUN_ID=$1
shift
STAGE=all
REVIEW=()
JUDGE=()
JUDGE_MODEL=sonnet
NOTHINK=
TIER=main
CR_ARGS=(--full)
while [ $# -gt 0 ]; do
  case $1 in
    --stage) STAGE=$2; shift ;;
    --limit | --only | --concurrency | --timeout-minutes) REVIEW+=("$1" "$2"); shift ;;
    --tier) JUDGE+=("$1" "$2"); TIER=$2; shift ;;
    --judge-model) JUDGE+=("$1" "$2"); JUDGE_MODEL=$2; shift ;;
    --no-thinking) JUDGE+=("$1"); NOTHINK=-nothink ;;
    --) shift; CR_ARGS=("$@"); break ;;
    -h | --help) usage ;;
    *) echo "unknown option: $1" >&2; usage 1 ;;
  esac
  shift
done

[ -d "$MARTIAN_DIR/bench/offline/golden_comments" ] || { echo "Run evals/martian/setup.sh first." >&2; exit 1; }
export MARTIAN_DIR
export CODE_REVIEWER_CLI=${CODE_REVIEWER_CLI:-$ROOT/dist/cli.js}
export CODE_REVIEWER_ARGS="${CR_ARGS[*]}"
[ -f "$CODE_REVIEWER_CLI" ] || { echo "$CODE_REVIEWER_CLI not found: npm run build" >&2; exit 1; }

if [ "$STAGE" = all ] || [ "$STAGE" = review ]; then
  python3 "$HERE/runner.py" "$RUN_ID" ${REVIEW[@]+"${REVIEW[@]}"}
fi
if [ "$STAGE" = all ] || [ "$STAGE" = judge ]; then
  python3 "$HERE/judge.py" "$RUN_ID" ${JUDGE[@]+"${JUDGE[@]}"}
  python3 "$HERE/report.py" "$RUN_ID:$JUDGE_MODEL$NOTHINK:$TIER"
fi
