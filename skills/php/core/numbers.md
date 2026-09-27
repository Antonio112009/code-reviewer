---
name: Numbers, casts and money
description: Numeric traps — floats for money, bcmath scale 0, silent integer overflow, lenient (int)/is_numeric parsing, TypeError and DivisionByZeroError in PHP 8, number_format output parsed back.
priority: 56
tags: [CWE-681, CWE-190, CWE-369]
activation:
  content:
    - '\b(?:round|floor|ceil|intdiv|fmod|number_format|intval|floatval|is_numeric)\s*\('
    - '\bbc(?:add|sub|mul|div|mod|pow|scale)\s*\(|\bBcMath\\Number\b'
    - '\((?:int|integer|float|double)\)\s*[$(]|\bPHP_INT_MAX\b'
sources:
  - https://www.php.net/manual/en/language.types.float.php
  - https://www.php.net/manual/en/bc.configuration.php
  - https://www.php.net/manual/en/language.types.numeric-strings.php
  - https://www.php.net/manual/en/migration85.incompatible.php
---
- **Floats for money**: `0.1 + 0.2 != 0.3` and `(int)(19.99 * 100)` is `1998` → totals and cents drift. Fix: integer minor units, bcmath or `BcMath\Number` (8.4), a money library.
- **bcmath scale 0**: `bcmath.scale` defaults to 0, so `bcdiv('10', '3')` is `'3'` and `bcmul('1.25', '2')` is `'2'` → fractions silently truncated. Fix: pass the scale argument on every call.
- **Silent overflow**: `PHP_INT_MAX + 1` becomes a float, `intval()` of huge strings saturates, out-of-range float-to-int casts are undefined (warning since 8.5) → corrupted IDs and counters.
- **Lenient casts**: `(int)'12abc'` is 12 and `(int)'1e3'` is 1000; `is_numeric()` accepts `'1e5'`, `' 1'`, `'1 '`, `'.5'` → garbage IDs and quantities pass. Fix: `ctype_digit()` on strings, `filter_var(..., FILTER_VALIDATE_INT)`.
- **PHP 8 errors**: arithmetic on non-numeric strings (`'abc' + 1`) throws `TypeError`, and `/` or `%` by zero throws `DivisionByZeroError` (was a warning) → user-supplied values cause 500s. Fix: validate before computing.
- **number_format round trip**: `number_format()` output such as `'1,234.50'` cast back with `(float)` becomes `1` → store raw numbers, format only for display.
