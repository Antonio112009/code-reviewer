---
name: I/O results and errno
description: POSIX/stdio I/O handling in C/C++ — short reads and writes, EINTR and close(), errno misuse, APIs that return error numbers, feof loops, fgets partial lines and unchecked close/flush after writes.
priority: 60
tags: [CWE-252, CWE-391, CWE-703]
activation:
  content:
    - '\b(?:read|write|pread|pwrite|recv|recvfrom|send|sendto|fread|fwrite|fgets|fclose|close|fflush|fsync)\s*\('
    - '\berrno\b|\bE(?:INTR|AGAIN|WOULDBLOCK)\b|\bfeof\s*\('
sources:
  - https://man7.org/linux/man-pages/man2/write.2.html
  - https://man7.org/linux/man-pages/man2/close.2.html
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/error-handling-err/err30-c/
  - https://en.cppreference.com/w/c/io/feof
---
- **Short transfers**: `read`/`write`/`recv`/`send`/`fread`/`fwrite` may move fewer bytes than asked (sockets, pipes, signals, full disks) → truncated data; `recv` returning 0 means the peer closed. Fix: loop until done.
- **EINTR**: interrupted calls failing with `EINTR` treated as fatal → spurious errors. Fix: retry — but never retry `close()` on Linux; the fd may already be reused by another thread.
- **errno misuse**: errno read although the call did not fail (success does not clear it), or after logging/`free`/`printf` that may change it → phantom errors. Fix: check the return value, then copy errno at once.
- **Error-number APIs**: `pthread_*` return the error number and leave errno alone; `getaddrinfo` returns `EAI_*` → `== -1`/`perror` checks miss failures. Fix: test the returned code.
- **feof loops**: `while (!feof(f))` handles the last record twice and spins on read errors. Fix: loop on the read call's result; check `ferror` afterwards.
- **Unchecked close/flush**: `fclose`/`close`/`fflush` results ignored after writing → delayed write errors (NFS, quota, full disk) lost, corrupt files reported as saved. Fix: check them; `fsync` before renaming over the original.
- **fgets pieces**: lines longer than the buffer arrive in parts and keep the newline; after a failure the buffer is indeterminate. Fix: detect a missing `\n`; check the result.
