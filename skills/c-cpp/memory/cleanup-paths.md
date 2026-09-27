---
name: Resource cleanup on error paths
description: C resource ownership — leaks and double releases on early returns and goto cleanup paths, fd 0 mix-ups, fdopen/close pairs and library results the caller must (or must not) free.
priority: 60
tags: [CWE-401, CWE-404, CWE-775, CWE-1341]
activation:
  content:
    - '\bgoto\s+\w+\s*;'
    - '\b(?:fopen|fdopen|fclose|open|openat|close|opendir|closedir|socket|accept4?|pipe2?|dup2?|mmap|munmap|getline|getdelim|asprintf|realpath|scandir|getaddrinfo|freeaddrinfo|regcomp|regfree)\s*\('
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/memory-management-mem/mem31-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio42-c/
  - https://man7.org/linux/man-pages/man3/getline.3.html
  - https://man7.org/linux/man-pages/man3/asprintf.3.html
---
- **Early exits skip cleanup**: `return` on an error path after `malloc`, `fopen`, `open`, `socket` or a lock without releasing them → leaks, fd exhaustion, deadlocks. Fix: one `goto cleanup` exit releasing in reverse order.
- **Releasing what was never acquired**: jumping to cleanup before all handles are initialized frees garbage; `fclose(NULL)` is UB. Fix: initialize pointers to NULL and fds to -1 at declaration; guard each release.
- **fd 0 mix-ups**: fds initialized to 0, or not reset to -1 after `close` → cleanup closes stdin or a descriptor already reused by another file/thread. Fix: `-1` sentinel; reset after closing.
- **Double close**: `fdopen(fd)` then both `fclose(f)` and `close(fd)`, or helper and caller both closing → the second close hits a reused fd. Fix: after `fdopen`, only `fclose`.
- **Caller-owned results**: `strdup`, `getline` (free the buffer even when it fails), `asprintf` (pointer undefined on failure — do not free), `realpath(p, NULL)`, `scandir`, `getaddrinfo`→`freeaddrinfo`, `regcomp`→`regfree`. Fix: follow each API's ownership rule.
