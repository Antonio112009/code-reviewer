---
name: Child processes (reliability)
description: Missing 'error' handlers, exec maxBuffer truncation, unconsumed pipes that block the child, exit vs close and signal exit codes, shells that keep grandchildren alive, replaced env, and Windows .bat/.cmd EINVAL.
priority: 60
activation:
  content:
    - '\bchild_process\b|\bexeca\b'
    - '(?<![.\w$])(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\('
    - '\b(?:cp|childProcess)\.\w+\s*\('
    - '\bmaxBuffer\b|\bkillSignal\b|\bdetached\s*:'
  examples:
    - 'const { spawn } = require("node:child_process");'
    - 'const child = spawn("git", ["status"]);'
    - 'cp.exec("ls -la", (err, stdout) => {});'
    - 'exec(cmd, { maxBuffer: 10 * 1024 * 1024 });'
sources:
  - https://nodejs.org/api/child_process.html#child-process
  - https://nodejs.org/api/child_process.html#event-error
  - https://nodejs.org/api/child_process.html#maxbuffer-and-unicode
  - https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
---
- **No `'error'` listener**: a missing binary (`ENOENT`) or permission error emits `'error'` → unhandled it crashes the process; `'exit'` may not fire, or both do. Fix: handle `'error'`, settle promises once.
- **`exec` buffering**: output beyond `maxBuffer` (1 MiB default, in bytes) kills the child and truncates output (git logs, dumps). Fix: `spawn` with streams.
- **Unconsumed pipes**: with default `stdio: 'pipe'`, unread stdout/stderr fills the OS pipe and the child blocks forever. Fix: consume both or use `stdio: 'ignore'`.
- **Exit handling**: stdio may still hold data at `'exit'` (read output on `'close'`); a signal-killed child has `code === null`, so `if (code) fail()` treats it as success. Fix: fail on `code !== 0`.
- **Shells keep grandchildren alive**: with `shell: true` or `sh -c`, `kill()` and the `timeout` option (SIGTERM only) stop the shell, not its children → orphaned work continues. Fix: spawn binaries directly; escalate to SIGKILL.
- **`env` replaces the environment**: `env: { API_KEY }` drops `PATH` and proxies → `ENOENT`. Fix: `env: { ...process.env, API_KEY }`.
- **Windows batch files**: since Node 18.20.2/20.12.2/21.7.3, spawning `.bat`/`.cmd` without `shell` throws `EINVAL` (CVE-2024-27980). Fix: `cmd.exe /d /s /c` with validated arguments.
