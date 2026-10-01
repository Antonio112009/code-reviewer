#!/usr/bin/env bash
# Builds one commit of Code Reviewer into its own directory, so a benchmark measures exactly that commit while
# the checkout moves on. Writes BUILD.json (commit, tags, version, patch) next to dist/; the benchmark scripts
# record it in each run's provenance.json.
#
#   evals/pin-build.sh <commit> [name] [--patch <file>]     → $BUILDS_DIR/<name>/dist/cli.js
#
# BUILDS_DIR defaults to ~/.cache/code-reviewer-builds; name defaults to the short commit. --patch applies an
# experiment on top of the commit (recorded by its SHA-256). Then: CODE_REVIEWER_CLI=$BUILDS_DIR/<name>/dist/cli.js
set -euo pipefail

[ $# -ge 1 ] || { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
COMMIT=$(git -C "$ROOT" rev-parse --verify "$1^{commit}")
shift
NAME=$(git -C "$ROOT" rev-parse --short "$COMMIT")
PATCH=
while [ $# -gt 0 ]; do
  case $1 in
    --patch) PATCH=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift ;;
    *) NAME=$1 ;;
  esac
  shift
done
BUILDS_DIR=${BUILDS_DIR:-$HOME/.cache/code-reviewer-builds}
DIR=$BUILDS_DIR/$NAME
[ ! -e "$DIR" ] || { echo "$DIR exists: pick another name or remove it" >&2; exit 1; }

mkdir -p "$DIR"
git -C "$ROOT" archive "$COMMIT" | tar -x -C "$DIR"
[ -z "$PATCH" ] || (cd "$DIR" && git apply "$PATCH")
(cd "$DIR" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && npm run build >/dev/null)

python3 - "$DIR" "$COMMIT" "$PATCH" "$(git -C "$ROOT" describe --tags --always "$COMMIT")" <<'PY'
import hashlib, json, sys, time
from pathlib import Path
d, commit, patch, describe = sys.argv[1:5]
build = {"commit": commit, "describe": describe,
         "version": json.loads(Path(d, "package.json").read_text())["version"],
         "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
if patch:
    build["patch"] = Path(patch).name
    build["patch_sha256"] = hashlib.sha256(Path(patch).read_bytes()).hexdigest()
Path(d, "BUILD.json").write_text(json.dumps(build, indent=1) + "\n")
print(json.dumps(build))
PY
echo "CODE_REVIEWER_CLI=$DIR/dist/cli.js"
