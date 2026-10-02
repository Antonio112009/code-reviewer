---
name: Dates and time zones
description: Date-only vs date-time parsing, zero-based months and overflow, silent Invalid Date, mutation of shared Date objects, DST and server-local arithmetic, hard-coded locales and zones, and Temporal availability.
priority: 55
tags: [CWE-682]
activation:
  content:
    - '\bnew\s+Date\s*\('
    - '\bDate\.(?:parse|UTC)\s*\('
    - '\.(?:get|set)(?:UTC)?(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Time)\s*\('
    - '\.to(?:ISO|Locale|LocaleDate|LocaleTime|UTC)String\s*\('
    - '\bTemporal\.'
    - '\bIntl\.(?:DateTimeFormat|RelativeTimeFormat)\b'
  examples:
    - 'const created = new Date(''2024-03-10'');'
    - 'const ms = Date.UTC(2024, 2, 10);'
    - 'start.setDate(start.getDate() + 1);'
    - 'const iso = created.toISOString();'
    - 'const now = Temporal.Now.zonedDateTimeISO();'
    - "const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });"
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal
  - https://nodejs.org/en/blog/release/v26.0.0
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
---
- **Date-only is UTC, date-time is local**: `new Date('2024-03-10')` is UTC midnight, `new Date('2024-03-10T00:00')` local → off-by-one days west of UTC; non-ISO strings are engine-defined. Fix: ISO with an explicit offset.
- **Zero-based months and overflow**: `new Date(2024, 1, 30)` becomes March 1; `setMonth(m + 1)` on Jan 31 lands in March; `getDay()` is the weekday. Fix: clamp the day or use a date library.
- **Invalid Date is silent**: bad input gives a Date whose `getTime()` is `NaN`; comparisons are false and `toISOString()` throws `RangeError` later. Fix: check `Number.isNaN(d.getTime())` after parsing.
- **Mutating shared Dates**: `setDate`/`setHours` mutate in place - `const end = start; end.setDate(…)` moves `start` too. Fix: copy with `new Date(start)` first.
- **Local-time arithmetic**: adding `86400000` ms is not "next day" across DST; `setHours(0, 0, 0, 0)` uses the server's zone, not the user's. Fix: UTC math or `Temporal.ZonedDateTime`/a zone-aware library.
- **Temporal availability**: native in Node ≥26, Chrome 144, Firefox 139, not Safari → `ReferenceError` without a polyfill; `<`/`>` on Temporal values throw `TypeError`. Fix: polyfill; `compare`/`equals`.
- **Hard-coded locale or zone**: `toLocaleString('en-US')`, `Intl.DateTimeFormat('en-US')` or a fixed `timeZone` in a localized UI → every user sees US formats and the server's or UTC times. Fix: the app's current locale and the user's time zone.
