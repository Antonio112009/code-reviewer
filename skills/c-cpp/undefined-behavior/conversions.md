---
name: Integer and float conversions
description: Implicit conversion bugs in C/C++ — signed/unsigned comparisons, unsigned underflow, narrowing, small-type promotion, plain char with ctype and EOF, and out-of-range float-to-integer conversion.
priority: 60
tags: [CWE-195, CWE-197, CWE-681, CWE-191]
activation:
  content:
    - '\b(?:int|long|short|unsigned|u?int(?:8|16|32)_t)\s+\w{1,40}\s*=\s*[^;\n]{0,120}\b(?:strlen|size|length|sizeof)\b'
    - '\(\s*(?:int|long|short|unsigned(?:\s+(?:int|char|short|long))?|size_t|u?int(?:8|16|32|64)_t)\s*\)\s*[\w(]'
    - '\bsize\(\)\s*-\s*\d|\bsize_t\s+\w{1,40}\s*=\s*[^;\n]{0,80}-\s*1\b|\bint\s+\w{1,20}\s*=\s*[^;\n]{0,40};\s*\w{1,20}\s*<\s*[^;\n]{0,80}\bsize\(\)'
    - '\b(?:is(?:alnum|alpha|blank|cntrl|digit|graph|lower|print|punct|space|upper|xdigit)|to(?:lower|upper))\s*\('
    - '\b(?:f?getc|getchar)\s*\(|\bEOF\b'
    - '\bstatic_cast\s*<\s*(?:int|long|short|unsigned|size_t|u?int\d+_t)\s*>'
    - '\b(?:l?l?round|lrint|trunc|floor|ceil)\s*\('
  examples:
    - 'int len = strlen(s);'
    - 'uint8_t diff = (uint8_t)(a - b);'
    - 'for (size_t i = v.size() - 1; i >= 0; i--) {'
    - 'if (isalpha(c)) { }'
    - 'int c = getchar();'
    - 'int n = static_cast<int>(len);'
    - 'long r = lround(x);'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int31-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str37-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/floating-point-flp/flp34-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio34-c/
---
- **Signed vs unsigned compare**: `int i < v.size()`, `len < sizeof buf` with a negative `len` → the negative side becomes huge and checks pass. Fix: reject negatives first, or use one signedness.
- **Unsigned underflow**: `v.size() - 1` or `end - start` when zero; `for (size_t i = n - 1; i >= 0; i--)` never ends → huge bounds. Fix: test for zero; count down with `i-- > 0`.
- **Narrowing**: `int n = strlen(s)`, `uint16_t len = size`, `ssize_t`/`off_t` kept in `int` or `long` (32-bit on Windows) → large values become small or negative lengths. Fix: keep `size_t`/`off_t`; range-check before narrowing.
- **Small-type promotion**: `uint16_t * uint16_t` promotes to signed `int` and can overflow (UB); `~u8 == 0xFF` is never true; `(uint8_t)(a - b)` wrap logic needs the cast. Fix: cast to the intended unsigned width.
- **Plain `char`**: signed on x86, unsigned on most ARM; `isalpha(c)`/`toupper(c)` with a negative `char` is UB; `char c = getc(f)` cannot hold `EOF` distinctly. Fix: `(unsigned char)c`; keep `getc` results in `int`.
- **Float to integer**: converting an out-of-range `double` — `(int)1e10`, NaN, huge ratios or timestamps — is UB (garbage or trap). Fix: range-check and `isnan` first; `lround` for rounding.
