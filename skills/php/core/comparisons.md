---
name: Comparisons and truthiness
description: Loose-comparison and truthiness traps — PHP 8 string/number comparison, numeric strings, non-strict in_array/array_search/switch, empty('0'), Elvis vs null-coalescing, isset on null, position 0 and filter_var returning 0.
priority: 60
tags: [CWE-697, CWE-480]
activation:
  content:
    - '[^=!<>]==[^=]|[^!]!=[^=]'
    - '\b(?:in_array|array_search|array_keys|strpos|stripos|strrpos|filter_var|empty)\s*\('
    - '\bswitch\s*\(|\?:'
sources:
  - https://www.php.net/manual/en/migration80.incompatible.php
  - https://www.php.net/manual/en/types.comparisons.php
  - https://www.php.net/manual/en/function.in-array.php
  - https://www.php.net/manual/en/filter.constants.php
---
- **PHP 8 comparison change**: int vs non-numeric string now compares as strings (`0 == 'abc'` and `0 == ''` are false, true in PHP 7) → migrated `== 0` emptiness checks flip. Fix: `===`.
- **Numeric strings**: `'1e3' == '1000'` and `'10' == '010'` are true → IDs and codes compare equal. Fix: `===`.
- **Non-strict search**: `in_array`/`array_search` without `true` compare loosely (`null == ''`, `null == 0`) → allow-lists accept wrong values. Fix: pass `true`.
- **switch vs match**: `switch` uses `==` (`case null` also hits `''` and `0`); `match` is strict and throws `UnhandledMatchError` without `default` → converting one into the other changes behaviour.
- **empty('0')**: `empty()`, `if ($s)` and `$s ?: $default` treat `'0'`, `0`, `[]` as missing → a real "0" input is rejected or replaced. Fix: `=== ''`, `??`.
- **isset and null**: `isset()` and `??` treat a key holding `null` as absent → explicit nulls get defaulted. Fix: `array_key_exists()`.
- **Position 0**: `if (strpos(...))` or `if (array_search(...))` misses a hit at index 0. Fix: `!== false`, `str_contains()`.
- **filter_var zero**: `FILTER_VALIDATE_INT` returns `0` for `'0'` and `false` on failure → `if (!filter_var(...))` rejects zero. Fix: `=== false`.
