---
name: Dates, calendars and time zones
description: Fixed-format DateFormatter without en_US_POSIX, YYYY/DD/hh pattern mistakes, ISO 8601 fractional seconds, millisecond epochs, 86,400-second days, date-only values shifted by time zones and Calendar.current used in business logic.
activation:
  content:
    - '\b(?:DateFormatter|ISO8601DateFormatter|DateComponents|Calendar|TimeZone|DateInterval)\b|\.dateFormat\b|\btimeIntervalSince(?:1970|ReferenceDate|Now)\b'
    - '\b(?:86_?400|3_?600)\b|\b60\s*\*\s*60\b|\.formatted\(\s*(?:date:|\.dateTime|\.iso8601)'
  examples:
    - 'let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"'
    - 'let tomorrow = date.addingTimeInterval(86400)'
sources:
  - https://developer.apple.com/documentation/foundation/dateformatter
  - https://developer.apple.com/documentation/foundation/iso8601dateformatter
  - https://github.com/swiftlang/swift-foundation/blob/main/Sources/FoundationEssentials/Formatting/Date%2BISO8601FormatStyle.swift
  - https://www.unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table
---
- **Fixed formats without POSIX locale**: API dates parsed via `dateFormat` without `Locale(identifier: "en_US_POSIX")` and an explicit `timeZone` → `nil` or wrong dates for 12-hour or non-Gregorian users. Fix: set both, or `ISO8601DateFormatter`.
- **Pattern letters**: `YYYY` is the week-based year (wrong around 28–31 Dec), `DD` day-of-year, `hh` 1–12 without `a`. Fix: `yyyy`, `dd`, `HH`.
- **Fractional seconds**: APIs mixing `…00Z` and `…00.123Z` break single-format parsers — `ISO8601DateFormatter` needs `.withFractionalSeconds` for fractions, then rejects values without them; `Date.ISO8601FormatStyle` accepts both only from Swift 6.2 Foundation (iOS 26). Fix: try both forms.
- **Epoch units**: millisecond timestamps passed to `Date(timeIntervalSince1970:)` → year ~50,000; seconds sent where ms are expected. Fix: convert explicitly.
- **Fixed-length days**: `+ 86_400` for "tomorrow" or `30 * 86_400` for a month → wrong across DST and month ends. Fix: `Calendar.date(byAdding:value:to:)`.
- **Date-only values**: birthdays or due dates parsed as `Date` in one zone and shown in another → off by one day. Fix: `DateComponents`.
- **User calendar in logic**: `Calendar.current` (Buddhist/Japanese calendars, varying `firstWeekday`) in billing, streaks or server keys → wrong years and weeks. Fix: `Calendar(identifier: .gregorian)` with a fixed `timeZone`.
