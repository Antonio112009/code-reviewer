---
name: Strings, regex and locale
description: String.split/replaceAll regex surprises, locale-dependent case conversion and number formatting, == on strings, Pattern recompilation in hot paths and catastrophic backtracking on user input.
priority: 55
tags: [CWE-185, CWE-1333, CWE-597]
activation:
  content:
    - '\.split\('
    - '\.replace(?:All|First)\('
    - '\.to(?:Lower|Upper)Case\(\s*\)'
    - '\bString\.format\(|\.formatted\('
    - '\bPattern\.(?:compile|matches)\(|\.matches\('
    - '\b(?:DecimalFormat|NumberFormat)\b'
    - '[!=]=\s*"'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Matcher.html#quoteReplacement(java.lang.String)
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Locale.html
---
- **split takes a regex**: `split(".")`, `split("|")`, `split("$")` → empty or per-character arrays. Fix: `Pattern.quote(sep)` or an escaped pattern.
- **split drops trailing empties**: `"a,b,,".split(",")` has 2 elements → CSV-like columns shift or index errors. Fix: `split(sep, -1)`.
- **Replacement strings**: `replaceAll`/`replaceFirst` with dynamic replacement text containing `$` or `\` → `IllegalArgumentException` or garbled output. Fix: `replace()` (literal) or `Matcher.quoteReplacement`.
- **Locale-sensitive casing**: `toLowerCase()`/`toUpperCase()` without a `Locale` on keys, headers or enum names → Turkish dotless ı breaks comparisons and `Enum.valueOf`. Fix: `Locale.ROOT`.
- **Locale-sensitive formatting**: `String.format("%.2f")`, `DecimalFormat`, `NumberFormat` print `3,14` in e.g. German locales → broken JSON, SQL, CSV or protocol values. Fix: `String.format(Locale.ROOT, …)`.
- **`==` on strings**: identity comparison passes for literals in tests but fails for runtime values (request data, DB rows). Fix: `equals`/`Objects.equals`.
- **Hot-path regex**: `String.matches`/`replaceAll`/`split` with non-trivial patterns or `Pattern.compile` in loops recompile every call. Fix: `static final Pattern`.
- **Catastrophic backtracking**: nested quantifiers like `(a+)+` or user-supplied patterns on user input → ReDoS; `java.util.regex` has no timeout. Fix: `Pattern.quote`, possessive quantifiers, input length limits.
