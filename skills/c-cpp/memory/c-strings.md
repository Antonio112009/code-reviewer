---
name: C string functions
description: NUL-termination and truncation bugs with strncpy, strncat, snprintf, strlcpy and unbounded C string APIs, plus missing room for the terminator.
priority: 70
tags: [CWE-120, CWE-170, CWE-193]
activation:
  content:
    - '\b(?:str(?:n?cpy|n?cat|l(?:cpy|cat)|len|n?dup)|stpn?cpy|v?sn?printf|gets|v?f?scanf|sscanf)\s*\('
sources:
  - https://man7.org/linux/man-pages/man7/string_copying.7.html
  - https://man7.org/linux/man-pages/man3/strlcpy.3.html
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str31-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str32-c/
---
- **strncpy is not a safe strcpy**: `strncpy(d, s, sizeof d)` leaves `d` unterminated when `s` fills it → later `strlen`/`%s` over-read. Fix: terminate explicitly or use a checked copy.
- **strncat's bound**: the size caps bytes appended from `src`, not the destination size; `strncat(d, s, sizeof d)` overflows. Fix: `sizeof d - strlen(d) - 1`, or `snprintf`.
- **snprintf return value**: it returns the untruncated length; `pos += snprintf(buf + pos, size - pos, …)` pushes `pos` past `size`, then `size - pos` wraps → overflow. Fix: check `ret < 0 || ret >= remaining`.
- **strlcpy/strlcat**: return the source length (glibc ≥ 2.38, POSIX.1-2024); truncation shows only by comparing with the size. Fix: check the result.
- **Unbounded APIs**: `strcpy`, `strcat`, `sprintf`, `gets` (removed in C11), `%s` in `scanf`/`sscanf` without a width on external input → overflow. Fix: widths (`%63s`), `snprintf`, length checks.
- **No room or no terminator**: `malloc(strlen(s))` without `+ 1`; bytes from `read`/`recv`/`fread` passed to `strlen`/`strcpy`/`%s` without a terminator → one-byte overflow or over-read. Fix: `len + 1`; terminate after reading.
