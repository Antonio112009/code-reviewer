---
name: Signed overflow, shifts and division
description: Integer UB in C/C++ — signed overflow and the overflow checks optimizers delete, INT_MIN negation and division, division by zero, and invalid or negative shifts (C vs C++20 rules).
priority: 65
tags: [CWE-190, CWE-369, CWE-758]
activation:
  content:
    - '\b(?:INT|LONG|LLONG|SHRT|SCHAR|INT(?:8|16|32|64)|INTMAX|PTRDIFF|SSIZE)_(?:MAX|MIN)\b'
    - '\bnumeric_limits\s*<'
    - '\b(?:__builtin_(?:add|sub|mul)_overflow|ckd_(?:add|sub|mul))\b'
    - '\b(?:1|0x[0-9a-fA-F]+)[uUlL]{0,3}\s*<<|(?:<<|>>)=|<<\s*(?:\d{2}|sizeof)'
    - '\b(\w+)\s*[-+]\s*\w+\s*[<>]=?\s*\1\b'
    - '\b(?:l?l?abs|imaxabs)\s*\('
  examples:
    - 'if (x > INT_MAX - y) overflow();'
    - 'auto max = std::numeric_limits<int>::max();'
    - 'if (__builtin_add_overflow(a, b, &result)) return -1;'
    - 'uint64_t mask = 1ULL << shift;'
    - 'if (a + b < a) return -1;'
    - 'int m = abs(x);'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int32-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int34-c/
  - https://en.cppreference.com/w/cpp/language/operator_arithmetic
  - https://en.cppreference.com/w/c/numeric/ckd_add
---
- **Deleted overflow checks**: `if (a + b < a)`, `if (x + 1 > x)`, `if (len + off < len)` on signed operands → signed overflow is UB, so compilers fold the test and remove it. Fix: check limits first (`a > INT_MAX - b`), or `ckd_add`/`__builtin_add_overflow`.
- **Two's complement is not wrapping**: C++20 fixed the representation, but signed overflow is still UB; `-fwrapv` is not portable. Fix: unsigned or wider arithmetic, or C23 `<stdckdint.h>` checked operations.
- **INT_MIN edge cases**: `-x`, `abs(x)`, `x / -1` and `x % -1` with `x == INT_MIN` → UB; x86 raises SIGFPE for the division. Fix: handle the minimum explicitly.
- **Division by zero**: divisors from input, config or counts that may be zero (`total / count`, `% buckets`) → UB, SIGFPE crash. Fix: validate before dividing.
- **Shift counts**: shifting by ≥ the promoted width or by a negative count is UB (`1 << 32`, `x << n` with `n` from input); `1 << 31` on a 32-bit `int` is UB in C. Fix: `1u`/`UINT64_C(1)` and range-check `n`.
- **Shifting negatives**: `-1 << n` is UB in C and before C++20; `x >> n` on negative `x` is implementation-defined before C++20. Fix: shift unsigned values.
