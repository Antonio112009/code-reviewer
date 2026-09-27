---
name: Signal handlers and fork
description: Async-signal-safety in C/C++ — unsafe calls and shared data in signal handlers, signal() semantics, SIGPIPE, fork() in multithreaded processes, descriptors leaking into children and exit() in forked children.
priority: 60
tags: [CWE-479, CWE-364, CWE-403]
activation:
  content:
    - '\b(?:signal|sigaction|sigprocmask|pthread_sigmask|sigwait|signalfd)\s*\(|\bsig_atomic_t\b|\bSIG(?:INT|TERM|HUP|CHLD|PIPE|ALRM|USR1|USR2)\b'
    - '\b(?:fork|vfork|execv\w*|execl\w*|posix_spawnp?|daemon)\s*\('
    - '\b(?:O_CLOEXEC|SOCK_CLOEXEC|FD_CLOEXEC|MSG_NOSIGNAL)\b'
sources:
  - https://man7.org/linux/man-pages/man7/signal-safety.7.html
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/signals-sig/sig30-c/
  - https://man7.org/linux/man-pages/man2/fork.2.html
  - https://man7.org/linux/man-pages/man2/open.2.html
---
- **Unsafe calls in handlers**: `printf`, `malloc`/`free`, `new`, `syslog`, `exit` or mutexes in a signal handler → deadlock or heap corruption when the signal interrupts the same code (SIG30-C). Fix: set a flag or `write()` to a self-pipe.
- **Shared data in handlers**: touching anything but `volatile sig_atomic_t` or lock-free atomics, or clobbering `errno` → UB, broken error checks. Fix: flag-only handlers; save/restore `errno`.
- **signal() semantics**: behaviour differs between systems and is undefined in multithreaded programs (CON37-C). Fix: `sigaction` with `SA_RESTART`; block signals in workers, `sigwait` in one thread.
- **SIGPIPE**: writing to a closed socket or pipe raises SIGPIPE, which kills the process by default. Fix: `MSG_NOSIGNAL`, or ignore SIGPIPE and handle `EPIPE`.
- **fork in threaded programs**: only the calling thread survives and other threads' locks (malloc, loggers) stay held, so the child may call only async-signal-safe functions until `exec`. Fix: `posix_spawn`, or exec at once.
- **Descriptor leaks**: fds opened without `O_CLOEXEC`/`SOCK_CLOEXEC`, or marked later with `fcntl(FD_CLOEXEC)` (racing a fork+exec) → children inherit sockets and secrets. Fix: set CLOEXEC at creation.
- **exit() in the child**: a forked child calling `exit()` flushes duplicated stdio buffers and runs the parent's `atexit` handlers. Fix: `_exit()` in children that do not exec.
