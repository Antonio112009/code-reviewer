---
name: Shell & PowerShell
description: Shell script defects in bash, sh, zsh and PowerShell, such as unquoted expansions, deletes on empty variables, errexit gaps, injection through sh -c or ssh, stdin-stealing and subshell loops, bashisms, self-truncation, unsafe temp files and PowerShell error and output traps.
category: language
priority: 52
tier: essential
tags:
  - CWE-78
  - CWE-88
  - CWE-377
  - CWE-754
  - OWASP-A05
activation:
  languages:
    - shell
    - text
  files:
    - "**/*.{sh,bash,zsh,ksh,bats,ps1,psm1}"
    - "**/.husky/*"
    - "**/.envrc"
  content:
    - ^#!\s*\S*/(?:env\s+(?:-S\s+)?)?(?:(?:ba|z|k|da|a)?sh|pwsh)\b
  examples:
    - '#!/usr/bin/env bash'
    - '#!/bin/sh'
---
- **Unquoted expansions**: unquoted `$var`, `$(cmd)` or `$@` in bash/sh, `[ -n $v ]` (true when empty) → splitting, globbing, dropped arguments, wrong branch. Fix: `"$var"`, `"$@"`, arrays.
- **Empty-path deletes**: `rm -rf "$DIR/"*` or `Remove-Item -Recurse "$Path\*"` with an empty variable, `rm` after an unchecked `cd` → wipes `/` or the wrong tree. Fix: `${DIR:?}`, `cd … || exit`.
- **Errexit gaps**: no `set -euo pipefail`; `set -e` ignored in functions called from `if`/`&&`; `curl` without `-f` exits 0 on HTTP errors; `&` jobs never `wait`ed → continues after failures. Fix: check statuses.
- **Injection**: `bash -c "$x"`, `ssh host "cmd $x"`, `find -exec sh -c '… {} …'`, `Invoke-Expression` → input run as code. Fix: pass data as arguments: `sh -c '… "$1"' _ "$f"`.
- **Loops**: `for f in $(ls)`, variables set in `cmd | while read` (subshell), `ssh` inside `while read` eating stdin → mangled names, lost state, one iteration. Fix: globs, `< <(cmd)`, `ssh -n`.
- **Portability**: `[[`, `==` or arrays under `#!/bin/sh` (dash); GNU-only `sed -i`, `readlink -f` on macOS; `$((08))` octal errors → CI-only failures. Fix: bash shebang, `10#$n`.
- **Files**: `sort f > f` empties `f` before reading; fixed `/tmp` names or `$$` suffixes; no cleanup `trap` → data loss, symlink attacks, leftovers. Fix: temp file then `mv`, `mktemp -d`, `trap … EXIT`.
- **PowerShell**: `$ErrorActionPreference = 'Stop'` ignores native exit codes; uncaptured output (`$list.Add()`) joins return values; `$arr -eq $null` filters → ignored failures, wrong results. Fix: check `$LASTEXITCODE`, `[void]`, `$null -eq $x`.
