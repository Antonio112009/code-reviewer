---
name: Dates, times and time zones
description: DateTime/DateTimeOffset/TimeSpan defects — local time on servers, Kind ignored in comparisons, Unspecified values shifted by ToUniversalTime, TimeSpan components vs totals, wall-clock durations, time-zone ids across OSes and date-only values.
priority: 56
activation:
  content:
    - '\bDateTime(?:Offset)?\.(?:Now|UtcNow|Today|Parse|ParseExact|TryParse|SpecifyKind)\b'
    - '\.(?:ToUniversalTime|ToLocalTime)\(|\bDateTimeKind\b|\bTimeZoneInfo\b|\bTimeProvider\b'
    - '\bTimeSpan\b|\.(?:Milliseconds|Seconds|Minutes|Hours|Days)\b'
  examples:
    - 'var createdAt = DateTime.Now;'
    - 'var utc = createdAt.ToUniversalTime();'
    - 'var timeout = TimeSpan.FromSeconds(90);'
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/datetime/choosing-between-datetime
  - https://learn.microsoft.com/en-us/dotnet/api/system.datetime.compare
  - https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu
---
- **Local time on servers**: `DateTime.Now`/`DateTime.Today` for timestamps, expiry, scheduling → depends on host time zone, jumps at DST, ambiguous when stored. Fix: `DateTime.UtcNow`/`DateTimeOffset.UtcNow` or an injected `TimeProvider` (.NET 8+).
- **Kind ignored**: `==`, `<`, `CompareTo` and subtraction compare ticks only, ignoring `Kind` → UTC vs local values compare wrong. `ToUniversalTime()` on `Kind=Unspecified` (DB/JSON values) treats it as local → shifted by the server offset. Fix: normalize, `SpecifyKind`, prefer `DateTimeOffset`.
- **TimeSpan components**: `.Milliseconds/.Seconds/.Minutes/.Hours/.Days` return one component (1.5 s → `Milliseconds == 500`), not totals. Fix: `TotalMilliseconds`, `TotalSeconds`, ….
- **Wall-clock durations**: elapsed time from `DateTime.UtcNow` differences → clock adjustments give negative/huge durations and broken timeouts. Fix: `Stopwatch.GetTimestamp()` + `Stopwatch.GetElapsedTime` (.NET 7+).
- **Time-zone ids**: hard-coded Windows ids (`"Eastern Standard Time"`) or IANA ids work cross-platform only with ICU (not in invariant/NLS mode); converting invalid/ambiguous DST times throws or picks an offset. Fix: IANA ids, `IsInvalidTime`/`IsAmbiguousTime` checks.
- **Date-only values**: birthdays/due dates as midnight `DateTime` converted to UTC or serialized with an offset → previous day in negative offsets. Fix: `DateOnly` (.NET 6+).
