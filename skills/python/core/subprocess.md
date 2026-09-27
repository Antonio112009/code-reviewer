---
name: Running subprocesses
description: subprocess/os.system reliability — unchecked exit codes, missing timeouts, timeouts that leave children running, PIPE deadlocks (also asyncio), env= replacing the environment, string args without a shell, bytes vs text and preexec_fn with threads.
priority: 58
activation:
  content:
    - "\\bsubprocess\\.\\w+\\s*\\("
    - "(?<![\\w.])(?:Popen|check_output|check_call)\\s*\\("
    - "\\bos\\.(?:system|popen|spawn\\w*|exec\\w+)\\s*\\("
    - "\\bcreate_subprocess_(?:exec|shell)\\s*\\("
sources:
  - https://docs.python.org/3/library/subprocess.html#subprocess.run
  - https://docs.python.org/3/library/subprocess.html#subprocess.Popen.communicate
  - https://docs.python.org/3/library/os.html#os.system
  - https://docs.python.org/3/library/asyncio-subprocess.html#asyncio.subprocess.Process.wait
---
- **Unchecked exit status**: `subprocess.run()`/`call()` ignore non-zero codes; `os.system()` returns an encoded wait status → failures treated as success. Fix: `check=True`; `os.waitstatus_to_exitcode()`.
- **No timeout**: `run()`, `check_output()`, `communicate()` wait forever by default → hung workers on prompts or stuck network. Fix: `timeout=`; `stdin=DEVNULL`.
- **Timeouts leave processes**: `communicate(timeout=)` doesn't kill the child; `run(timeout=)` kills only the direct child, so `shell=True`/wrapper grandchildren survive. Fix: `proc.kill(); proc.communicate()`; `start_new_session=True` + `os.killpg`.
- **Pipe deadlock**: `stdout=PIPE`/`stderr=PIPE` then `.wait()`, or reading one pipe at a time, blocks once a pipe buffer fills (asyncio `proc.wait()` too). Fix: `communicate()`.
- **`env=` replaces the environment**: `env={"TOKEN": t}` drops `PATH`, `HOME`, proxies → "command not found" only in production. Fix: `env={**os.environ, "TOKEN": t}`.
- **String command without shell**: `run("git status")` looks for a program named `git status` on POSIX. Fix: pass a list; don't add `shell=True`.
- **Bytes vs text**: output is bytes unless `text=True`/`encoding=` → `out == "ok"` is always False. Fix: `encoding="utf-8"`.
- **`preexec_fn` with threads**: can deadlock the child before `exec`. Fix: `start_new_session`, `process_group` (3.11+).
