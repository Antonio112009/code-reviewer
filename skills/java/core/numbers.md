---
name: Numeric precision and overflow
description: BigDecimal construction, equality, division and rounding traps, floating point for money, int overflow before widening, Math.abs(Integer.MIN_VALUE), integer division and silent narrowing casts.
priority: 58
tags: [CWE-190, CWE-681, CWE-1339]
activation:
  content:
    - '\bBigDecimal\b'
    - '\bMath\.(?:abs|round)\('
    - '\(\s*(?:int|short|byte|float)\s*\)'
    - '\b(?:double|float|Double|Float)\s+\w*(?:[Pp]rice|[Aa]mount|[Tt]otal|[Bb]alance|[Cc]ost|[Ff]ee|[Tt]ax|[Mm]oney)\w*\b'
    - '\b\d+\s*\*\s*\d+\s*\*\s*\d+'
    - '\bhashCode\(\)\s*%'
  examples:
    - 'BigDecimal total = BigDecimal.ZERO;'
    - 'int abs = Math.abs(delta);'
    - 'int n = (int) longValue;'
    - 'double totalPrice = quantity * unitPrice;'
    - 'int daySeconds = 60 * 60 * 24;'
    - 'int bucket = key.hashCode() % buckets.length;'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Math.html#abs(int)
  - https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html#jls-5.1.3
---
- **BigDecimal(double)**: `new BigDecimal(0.1)` stores 0.1000000000000000055… → off-by-a-cent totals and failed comparisons. Fix: `BigDecimal.valueOf(d)` or the `String` constructor.
- **BigDecimal.equals**: compares scale too (`2.0` ≠ `2.00`), also as map keys or set elements. Fix: `compareTo(...) == 0` or `stripTrailingZeros()`.
- **divide / setScale**: `a.divide(b)` throws `ArithmeticException` for non-terminating results (1/3); `setScale(n)` without a `RoundingMode` throws when digits are dropped. Fix: pass scale and `RoundingMode`.
- **Floating-point money**: `double`/`float` prices or amounts summed and compared → rounding drift. Fix: `BigDecimal` or `long` minor units.
- **int arithmetic before widening**: `long ms = days * 24 * 3600 * 1000` overflows and `double avg = sum / count` truncates, because both are computed in `int`. Fix: `1000L`, `(double) sum`, `Math.multiplyExact`.
- **abs(MIN_VALUE)**: `Math.abs(Integer.MIN_VALUE)` is negative, so `Math.abs(hash) % n` can be a negative index. Fix: `Math.floorMod(hash, n)`.
- **Silent narrowing**: `(int) someLong` drops high bits; `(int) someDouble` saturates and maps NaN to 0 → corrupt ids, sizes, offsets. Fix: `Math.toIntExact`, range checks.
