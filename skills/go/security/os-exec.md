---
name: os/exec command and option injection
description: Shell wrappers around user input, argument/option injection into CLIs, user-chosen binaries, inherited or attacker-set environment variables and CommandContext timeouts that leave children and pipes behind.
priority: 78
tags: [CWE-78, CWE-88, CWE-526]
activation:
  content:
    - '"os/exec"'
    - '\bexec\.(?:Command|CommandContext|LookPath)\b'
    - '\bcmd\.(?:Env|Run|Start|Output|CombinedOutput|Wait|WaitDelay|Cancel|SysProcAttr)\b'
    - '\bsyscall\.(?:Exec|ForkExec)\b'
  examples:
    - 'import "os/exec"'
    - 'cmd := exec.Command("sh", "-c", "convert "+name)'
    - 'cmd.Env = append(os.Environ(), "LD_PRELOAD="+path)'
    - 'syscall.Exec(binary, args, env)'
sources:
  - https://pkg.go.dev/os/exec
  - https://pkg.go.dev/os/exec#Cmd.WaitDelay
  - https://go.dev/blog/path-security
---
- **Shell wrappers**: `exec.Command("sh", "-c", "convert "+name)` (or `bash -c`, `cmd /C`) with any interpolated input → command injection; os/exec itself never invokes a shell. Fix: run the binary directly with separate arguments.
- **Option injection**: user values passed as arguments that may start with `-` (`git clone --upload-pack=…`, `curl -o`, `tar --to-command`, `ssh -oProxyCommand`) → code execution or file writes. Fix: `--` before operands; reject leading `-`; allowlist URL schemes.
- **User-chosen program**: program name or path from requests or user-editable config → arbitrary execution. Fix: fixed absolute paths or an allowlist.
- **Environment**: `cmd.Env == nil` inherits the whole environment (DB passwords, cloud tokens) into third-party tools; appending user-supplied `KEY=value` (`LD_PRELOAD`, `GIT_SSH_COMMAND`, `PATH`) → code execution. Fix: minimal explicit `Env`.
- **Timeouts that don't stop**: `exec.CommandContext` kills only the direct child; grandchildren (from `sh -c` or scripts) keep stdout pipes open so `Wait`/`Output` hang. Fix: `cmd.WaitDelay` (Go 1.20+), process groups with group kill.
- **Output handling**: `Output`/`CombinedOutput` buffer unbounded output → memory; calling `Wait` before reading all of `StdoutPipe` → deadlock or lost output. Fix: stream and read to EOF before `Wait`.
