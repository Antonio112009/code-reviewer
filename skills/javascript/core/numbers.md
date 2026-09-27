---
name: Numbers, money and BigInt
description: Binary floating point in money math, toFixed rounding, integers above 2^53, BigInt mixing and serialization, negative rounding/modulo and silent NaN, Infinity and 32-bit overflow.
priority: 55
tags: [CWE-681, CWE-190, CWE-682]
activation:
  content:
    - '\.toFixed\s*\('
    - '\bMath\.(?:round|floor|ceil|trunc)\s*\('
    - '\bBigInt\b|\b\d+n\b'
    - '\bNumber\.(?:MAX_SAFE_INTEGER|isInteger|isSafeInteger|EPSILON)\b'
    - '\s%\s|\|\s*0\b|>>>?\s*0\b'
    - '\b(?:price|amount|total|balance|cents|tax|fee)\w*\s*[*/]'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse#using_the_context_argument
---
- **Float money**: `0.1 + 0.2 !== 0.3`, `(1.005).toFixed(2) === '1.00'`, and `toFixed` returns a string (`+` then concatenates) → wrong totals, taxes and comparisons. Fix: integer minor units or a decimal library.
- **Unsafe integers**: int64 ids/amounts above 2^53−1 (Snowflake ids, BIGINT columns) silently lose precision in `Number`, `JSON.parse`, `parseInt` → the wrong record is read or updated. Fix: keep strings or `BigInt` (reviver `context.source`: Node ≥21, Safari 18.4).
- **BigInt traps**: mixing with numbers throws `TypeError`, `JSON.stringify` throws on it, `BigInt(1.5)` throws `RangeError`, division truncates, `typeof x === 'number'` checks miss it. Fix: convert at boundaries, add a replacer.
- **Negative rounding and modulo**: `Math.round(-2.5) === -2`; `-7 % 3 === -1` (sign of the dividend) → negative indexes, wrong bucket or weekday math. Fix: `((n % m) + m) % m`, choose `trunc` vs `floor` deliberately.
- **Silent overflow**: `x / 0` is `Infinity`; `NaN` fails every comparison (`if (n > max)` lets it pass); `x | 0` wraps above 2^31; `setTimeout` delays over ~24.8 days fire almost immediately. Fix: `Number.isFinite` guards, clamp delays.
