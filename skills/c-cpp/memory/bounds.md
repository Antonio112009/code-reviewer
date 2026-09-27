---
name: Buffer bounds
description: Out-of-bounds reads and writes in C/C++ — off-by-one limits, sizeof of pointers, byte vs element counts, size arguments taken from the source, overlapping copies and negative indexes.
priority: 70
tags: [CWE-787, CWE-125, CWE-193, CWE-467]
activation:
  content:
    - '\bmem(?:cpy|move|set|cmp)\s*\('
    - '\bsizeof\b'
    - '<=\s*[\w.>-]{0,40}?(?:len|size|count|max|LEN|SIZE|COUNT|MAX)'
    - '\[\s*\w{0,40}?(?:len|size|count|LEN|SIZE|COUNT)\s*[-+]?\s*\d*\s*\]'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/arrays-arr/arr30-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/arrays-arr/arr38-c/
  - https://en.cppreference.com/w/c/string/byte/memcpy
  - https://en.cppreference.com/w/cpp/language/ub
---
- **Off-by-one limits**: `i <= n` over `n` elements, `buf[len] = 0` when `len == sizeof buf`, `>` instead of `>=` → one past the end; optimizers may assume it never happens and drop the exit test. Fix: `<` with element counts.
- **sizeof of a pointer**: `sizeof(p)` or `sizeof(param)` (array parameters decay) used as a buffer size, `sizeof(&s)` → only 4/8 bytes handled, or overflow. Fix: pass lengths explicitly.
- **Bytes vs elements**: `i < sizeof(arr)` over non-`char` arrays, `memcpy(d, s, count)` → overrun by the element size. Fix: `sizeof arr / sizeof arr[0]`, `count * sizeof *d`.
- **Size from the source side**: `memcpy(dst, src, src_len)`, `strncpy(d, s, strlen(s))` without comparing to the destination capacity → overflow once input grows. Fix: bound by the destination size.
- **Overlapping copies**: `memcpy`/`strcpy`/`sprintf(buf, "%s…", buf)` with overlapping buffers → UB, garbled data. Fix: `memmove` or a separate buffer.
- **Negative indexes**: indexes from `-1` error returns, signed subtraction or `hash % n` with a negative hash → access before the buffer. Fix: check `< 0` or keep index math unsigned.
