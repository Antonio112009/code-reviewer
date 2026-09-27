---
name: Spawning processes
description: std/tokio Command pitfalls — unchecked exit status, pipe deadlocks, unwaited children, shell and argument injection, Windows batch-file escaping, inherited secrets and process::exit skipping destructors.
priority: 62
tags: [CWE-78, CWE-88, CWE-252, CWE-526]
activation:
  content:
    - '\b(?:std|tokio)::process\b|\bCommand::new\('
    - '\bStdio::(?:piped|inherit|null)\b'
    - '\.(?:status|output|spawn|wait_with_output|kill_on_drop|env_clear)\('
    - '\bprocess::exit\('
sources:
  - https://doc.rust-lang.org/std/process/struct.Command.html
  - https://doc.rust-lang.org/std/process/struct.Child.html
  - https://blog.rust-lang.org/2024/04/09/cve-2024-24576/
---
- **Unchecked exit status**: `status()`/`output()` return `Ok` for non-zero exits → a failed git, ffmpeg or pg_dump run counts as success. Fix: check `status.success()`, surface stderr.
- **Pipe deadlock**: piping stdout and stderr, then `wait()` or reading one pipe to EOF first → the child blocks on a full pipe. Fix: `output()`/`wait_with_output()`, or read both concurrently.
- **Unwaited children**: `Child` never kills on drop (tokio needs `kill_on_drop(true)`); children never waited become orphans or zombies. Fix: `wait`/`kill` on every path.
- **Shell interpolation**: `Command::new("sh").arg("-c").arg(format!(..))` or `cmd /C` with input → command injection. Fix: run the program directly, one `.arg()` per value.
- **Argument injection**: values starting with `-` passed to git, ssh, curl, tar (`--upload-pack=…`) → code execution. Fix: validate; put `--` before positional args.
- **Windows batch files**: before Rust 1.77.2 (CVE-2024-24576; more cases fixed in 1.81) args to `.bat`/`.cmd` were escaped unsafely; now `spawn` fails with `InvalidInput`. Fix: no batch wrappers for untrusted args.
- **Inherited environment**: children get every env var (tokens, `DATABASE_URL`) → secrets leak to third-party tools. Fix: `env_clear()` plus explicit `env()`.
- **`process::exit` skips destructors**: buffers are not flushed, temp files and locks not cleaned up. Fix: return an `ExitCode` from `main`.
