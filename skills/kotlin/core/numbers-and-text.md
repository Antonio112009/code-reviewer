---
name: Numbers, equality and text
description: Value-semantics traps in Kotlin — BigDecimal `==` comparing scale, boxed identity, silent overflow and truncation, integer division, default-locale formatting and case mapping, and split/replace taking literal strings where Java takes regexes.
priority: 57
tags: [CWE-190, CWE-197, CWE-697]
activation:
  content:
    - '\bBigDecimal\b'
    - '==='
    - '\.to(?:Int|Short|Byte)\(\)'
    - '\.format\s*\('
    - '\bString\.format\b'
    - '\.(?:split|replace)\s*\(\s*"[^"\n]{0,40}\\\\'
    - '\.split\s*\(\s*"[|.*+?^$]"'
    - '\.(?:lowercase|uppercase)\s*\(\s*Locale'
sources:
  - https://kotlinlang.org/docs/equality.html
  - https://kotlinlang.org/docs/numbers.html
  - https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html#equals(java.lang.Object)
  - https://kotlinlang.org/docs/java-to-kotlin-idioms-strings.html#split-a-string
---
- **BigDecimal `==`**: `==` calls `equals()`, which compares scale too (`2.0 != 2.00`) → amount checks fail while `<`/`>` agree. Fix: `compareTo(b) == 0`.
- **Boxed identity**: `===` on `Int?`/`Long?` holds only for cached values −128..127 → breaks for larger IDs. Fix: `==`.
- **Silent overflow**: `Int` math (`a * b`, millis or byte sizes in `Int`, `sum()`) wraps without error. Fix: `Long`, `Math.multiplyExact`.
- **Truncation**: `Long.toInt()` keeps low bits; `Double.toInt()` truncates and clamps (NaN → 0) → wrong IDs or prices. Fix: range-check; `roundToInt()`.
- **Integer division**: `done / total * 100` with `Int`s stays 0 until complete. Fix: multiply first or use `Double`/`BigDecimal`.
- **Default-locale formatting**: `"%.2f".format(x)` and `String.format` use the default locale → `3,14` breaks JSON, SQL, URLs and parsers on de/fr/ru devices. Fix: `String.format(Locale.ROOT, …)`.
- **Locale case mapping**: `lowercase(Locale.getDefault())` on keys, headers or enum names → Turkish `I`→`ı` mismatches. Fix: invariant `lowercase()` for machine text.
- **Literal split/replace**: `split("\\s+")`, `split("|")`, `replace("\\d", "")` take the string literally, unlike Java's regex `split`/`replaceAll` → nothing split or replaced. Fix: pass `Regex(...)`.
