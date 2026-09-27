---
name: Regular expressions
description: Stateful g/y regexes, replace vs replaceAll and $-patterns in replacement strings, unanchored or mis-grouped validation patterns, ASCII-only classes, match vs matchAll and unescaped dynamic patterns.
priority: 55
activation:
  content:
    - '\.(?:test|exec|match|matchAll|replace|replaceAll|search)\s*\('
    - '\.lastIndex\b'
    - '\bnew\s+RegExp\s*\('
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/test#using_test_on_a_regex_with_the_global_flag
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#specifying_a_string_as_the_replacement
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/matchAll
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape
---
- **Shared `g`/`y` state**: a reused regex with `g` or `y` in `test()`/`exec()` keeps `lastIndex` between calls → the same input alternates true/false. Fix: no `g` for boolean tests, or a fresh regex.
- **Replace semantics**: a string pattern replaces only the first match; replacement strings expand `$&`, `$1`, `$'` → user text containing `$` is mangled or injects content. Fix: `replaceAll`; a replacer function `() => value`.
- **Unanchored or mis-grouped validators**: `/\d{4}/.test(pin)` accepts `ab1234cd`; `/^a|b$/` means `(^a)|(b$)` → validation bypass. Fix: `^(?:…)$` around the whole pattern.
- **ASCII-only classes**: `\w`, `\d`, `\b` ignore accented and non-Latin letters even with `u`; `.` skips newlines without `s` → valid names rejected. Fix: `\p{L}` with `u`/`v`, the `s` flag.
- **`match` with `g` drops groups**: it returns whole matches only; `matchAll` needs `g` (TypeError without) and is a one-shot iterator. Fix: `Array.from(str.matchAll(re))`.
- **Unescaped dynamic patterns**: `new RegExp(prefix + '.*')` with `.`, `+`, `(` in the variable changes the meaning or throws `SyntaxError` at runtime. Fix: `RegExp.escape` (Node ≥24, Chrome 136, Safari 18.2) or an escape helper.
