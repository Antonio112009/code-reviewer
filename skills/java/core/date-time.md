---
name: Dates, times and time zones
description: java.time and legacy date pitfalls — shared SimpleDateFormat, YYYY/DD/hh pattern letters, LocalDateTime for instants, implicit default zones and locales, DST-unsafe arithmetic, 0-based Calendar months and zone-sensitive equals.
priority: 55
tags: [CWE-362, CWE-682]
activation:
  content:
    - '\b(?:SimpleDateFormat|DateFormat|DateTimeFormatter|LocalDateTime|LocalDate|ZonedDateTime|OffsetDateTime|Instant|ZoneId|ZoneOffset|Calendar|GregorianCalendar|Duration|Period|TimeZone)\b'
    - '\bnew\s+Date\('
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/format/DateTimeFormatter.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/SimpleDateFormat.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/package-summary.html
---
- **Shared SimpleDateFormat**: a `static`/singleton `SimpleDateFormat` used by several threads → wrong dates and random exceptions. Fix: `DateTimeFormatter` (immutable) or one instance per call.
- **Pattern letters**: `YYYY` (week-based year) prints the wrong year around New Year; `DD` is day-of-year, `hh` is 1–12, `mm` is minutes. Fix: `yyyy-MM-dd HH:mm` (or `uuuu`).
- **LocalDateTime for instants**: event times stored or sent as `LocalDateTime` lose their zone → wrong ordering across servers, ambiguous DST hours. Fix: `Instant`/`OffsetDateTime` in UTC.
- **Implicit default zone**: `LocalDate.now()`, `ZoneId.systemDefault()`, `Calendar.getInstance()` follow the server TZ → "today" and cut-offs shift between hosts. Fix: explicit `ZoneId` or an injected `Clock`.
- **DST arithmetic**: adding `Duration.ofDays(1)` or 24 h to `Instant`s for calendar days → 23/25-hour days. Fix: `plusDays`/`Period` on zoned or local dates.
- **Default locale**: `DateTimeFormatter.ofPattern(p)` parses month/day names in the default locale → `"Mar"` fails on other hosts. Fix: `ofPattern(p, Locale.ROOT)`.
- **Legacy Date/Calendar**: `Calendar` months are 0-based and `Date.getYear()` is offset by 1900. Fix: `java.time`.
- **Zone-sensitive equals**: `ZonedDateTime`/`OffsetDateTime.equals` also compare zone/offset → the same instant looks different. Fix: `isEqual` or compare `toInstant()`.
