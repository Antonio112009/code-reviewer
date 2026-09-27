---
name: Command execution and privileges
description: Process execution and privilege handling in C/C++ — system/popen with interpolated input, argument injection, PATH search in privileged code, trusted environment variables, and privilege drops in the wrong order or unchecked.
priority: 80
tags: [CWE-78, CWE-88, CWE-426, CWE-250, CWE-273]
activation:
  content:
    - '\b(?:system|popen|_popen|exec[lv]p?e?|execvpe|posix_spawnp?|ShellExecute\w*|CreateProcess\w*)\s*\('
    - '\b(?:setuid|setgid|seteuid|setegid|setresuid|setresgid|setreuid|setregid|setgroups|initgroups|getenv|secure_getenv)\s*\('
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/environment-env/env33-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/posix-pos/pos36-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/posix-pos/pos37-c/
  - https://man7.org/linux/man-pages/man3/getenv.3.html
---
- **Shell commands from input**: `system()`/`popen()` with `sprintf`-built strings containing file names, hosts or user values → shell injection via `;`, `$()`, backticks (ENV33-C). Fix: `posix_spawn`/`execve` with an argv array, no shell.
- **Argument injection**: user values passed as argv elements that start with `-` (`tar`, `git`, `curl`, `ssh`) become options. Fix: validate and put `--` before positional arguments.
- **PATH lookup in privileged code**: `execvp`/`execlp`/`posix_spawnp` or `system("tool …")` in setuid or root code resolve the program through the caller's `PATH` → attacker binary runs. Fix: absolute paths; `execve` with a clean environment.
- **Trusted environment**: privileged code taking paths, config or temp dirs from `getenv` → attacker-controlled. Fix: `secure_getenv` (glibc ≥ 2.17) or fixed defaults; scrub the environment before exec.
- **Drop order**: `setuid()` before `setgid()`/`setgroups()` → group privileges can no longer be dropped and root's groups remain (POS36-C). Fix: `setgroups`, then `setgid`/`setresgid`, then `setuid`/`setresuid`.
- **Unchecked drops**: ignoring `setuid`/`setgid` return values, or `seteuid` for a permanent drop (reversible) → code keeps running as root (POS37-C). Fix: check every call; verify with `getuid`/`geteuid`.
