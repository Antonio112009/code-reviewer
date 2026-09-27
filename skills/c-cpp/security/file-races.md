---
name: Filesystem races and permissions
description: File handling security in C/C++ — check-then-open TOCTOU, predictable temp files, path-based follow-up calls, directory traversal, permissive creation modes and readlink without termination.
priority: 75
tags: [CWE-367, CWE-377, CWE-59, CWE-22, CWE-732]
activation:
  content:
    - '\b(?:access|faccessat|stat|lstat|open|openat|openat2|creat|fopen|chmod|chown|lchown|rename|unlink|symlink|mkdir|realpath|readlink)\s*\('
    - '\b(?:tmpnam|tempnam|mktemp|mkstemp|mkdtemp|tmpfile)\s*\(|\bO_(?:CREAT|EXCL|NOFOLLOW|TMPFILE)\b|["'']/tmp/'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio45-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/posix-pos/pos35-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/posix-pos/pos30-c/
  - https://man7.org/linux/man-pages/man2/openat2.2.html
---
- **Check then use**: `access()`/`stat()`/`lstat()` on a path, then `open()`/`fopen()` of the same path → a symlink swapped in between wins (FIO45-C). Fix: open first (`O_NOFOLLOW`), then `fstat` the fd.
- **Temporary files**: `tmpnam`/`tempnam`/`mktemp` + open, or fixed names like `/tmp/app.lock` → symlink or pre-creation attacks. Fix: `mkstemp`/`mkdtemp`/`tmpfile`, `O_TMPFILE`, or `O_CREAT | O_EXCL`.
- **Path-based follow-ups**: `chmod`/`chown`/`rename`/`unlink` by path after checking or creating a file → they act on whatever the path points to now. Fix: `fchmod`/`fchown`, `*at()` calls on a directory fd.
- **Directory traversal**: user names joined to a base directory without rejecting `..`, absolute paths or symlinks; `realpath` then `open` is racy. Fix: `openat2` with `RESOLVE_BENEATH` (Linux ≥ 5.6), or per-component `O_NOFOLLOW`.
- **Permissive creation**: `open(…, O_CREAT, 0666)` or `fopen("w")` for secrets under a loose umask, `chmod` after writing → readable window. Fix: create with `0600`.
- **readlink**: never NUL-terminates and silently truncates (POS30-C). Fix: reserve a byte, terminate, treat `len == bufsiz` as truncation.
