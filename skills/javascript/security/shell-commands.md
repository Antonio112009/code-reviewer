---
name: Command and argument injection
description: child_process exec/execSync or shell:true with interpolated input, args arrays combined with shell (DEP0190), Windows .bat/.cmd execution, option injection through leading dashes, and user-controlled env/cwd/executables.
priority: 80
tags: [CWE-78, CWE-88, A05:2025]
activation:
  content:
    - '\bchild_process\b|\bexeca\b|\bshelljs\b|\bzx\b'
    - '(?<![.\w$])(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\('
    - '\bshell\s*:\s*(?:true|[''"])'
    - '\.(?:bat|cmd)[''"`]'
sources:
  - https://nodejs.org/api/child_process.html#child_processexeccommand-options-callback
  - https://nodejs.org/api/deprecations.html#dep0190-passing-args-to-nodechild_process-execfilespawn-with-shell-option
  - https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
  - https://cwe.mitre.org/data/definitions/88.html
---
- **Shell interpolation**: `exec`/`execSync` or `spawn(…, { shell: true })` with template strings containing request data, file names or branch names → `;`, `$(…)`, backticks run arbitrary commands. Fix: `execFile`/`spawn` with an args array and no shell.
- **`shell: true` with an args array**: the arguments are only space-joined, not escaped (runtime-deprecated as DEP0190 in Node 24) → injection despite looking parameterized. Fix: drop `shell`.
- **Windows batch files**: `.bat`/`.cmd` always run through `cmd.exe`; after CVE-2024-27980 Node requires `shell: true` for them, which re-opens injection via `&`, `|`, `%VAR%`. Fix: avoid batch wrappers or strictly allowlist argument characters.
- **Argument injection**: values starting with `-` become options even without a shell (`git clone --upload-pack=…`, `tar --checkpoint-action`, `curl -o`, `ssh -oProxyCommand`) → code execution or file writes. Fix: `--` before positional values, reject leading `-`, allowlist.
- **Controlled executable or environment**: user input choosing the binary, `cwd`, or env entries (`NODE_OPTIONS`, `LD_PRELOAD`, `PATH`) → code execution. Fix: fixed absolute binaries and an allowlisted env.
