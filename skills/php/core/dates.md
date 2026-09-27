---
name: Dates, times and time zones
description: DateTime/Carbon traps — mutable objects, +1 month overflow, createFromFormat filling and overflowing fields, Y vs o week years, default time zone (UTC fallback in 8.2), strtotime false, Carbon 3 signed float diffs.
priority: 57
tags: [CWE-682, CWE-1339]
activation:
  content:
    - '\b(?:DateTime|DateTimeImmutable|DateInterval|Carbon|CarbonImmutable)\b'
    - '\b(?:strtotime|mktime|date_create|date_default_timezone_set)\s*\('
    - '->(?:modify|add|sub|setDate|diffIn\w+|addMonths?|subMonths?)\s*\('
    - '\bdate\s*\(\s*[''"][^''"\n]{0,40}W'
sources:
  - https://www.php.net/manual/en/datetimeimmutable.createfromformat.php
  - https://www.php.net/manual/en/datetime.examples-arithmetic.php
  - https://www.php.net/manual/en/datetime.format.php
  - https://laravel.com/docs/11.x/upgrade
---
- **Mutable objects**: `DateTime::modify()`/`add()` and Carbon `addDay()` change the object itself → `$end = $start->modify('+1 day')` also moves `$start`. Fix: `DateTimeImmutable`, `CarbonImmutable`.
- **Month overflow**: `+1 month` on Jan 31 gives Mar 3 (Mar 2 in leap years) → billing periods skip months. Fix: `'last day of next month'`, Carbon `addMonthsNoOverflow()`.
- **createFromFormat**: fields missing from the format take the current time and out-of-range values overflow (`2025-02-30` becomes Mar 2) → equality checks fail, impossible dates validate. Fix: `!` prefix, compare `format()` with the input.
- **Week years**: `date('Y-W')` mislabels Dec 29–Jan 3 (ISO week 1 or 53 belongs to the other year). Fix: `'o-W'`.
- **Time zones**: `date()`, `strtotime()`, `new DateTime()` use `date.timezone` (UTC fallback since 8.2) → results differ per server; `+86400` seconds is not one day across DST. Fix: explicit `DateTimeZone`, store UTC.
- **Invalid input**: `strtotime()` returns `false` (`date('Y-m-d', false)` is 1970-01-01); `new DateTimeImmutable($input)` throws (`DateMalformedStringException` in 8.3) → 500s.
- **Carbon 3**: `diffIn*()` return signed floats (negative when the argument is earlier; Laravel 12 requires Carbon 3) → `> 30` checks and `(int)` casts break. Fix: `abs()`, explicit rounding.
