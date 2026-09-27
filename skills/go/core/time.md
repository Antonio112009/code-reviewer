---
name: time values, durations and layouts
description: Comparing time.Time with ==, Duration unit mistakes, reference-layout typos, missing locations when parsing, calendar arithmetic normalisation and zero times.
priority: 55
tags: [CWE-682]
activation:
  content:
    - '\btime\.(?:Parse\w{0,10}|Unix\w{0,5}|Duration|Date|LoadLocation|Local|UTC)\b'
    - '\.(?:AddDate|Truncate|Round|Format|Equal|Before|After|Sub|IsZero)\('
    - '\btime\.(?:Nanosecond|Microsecond|Millisecond|Second|Minute|Hour)\b'
sources:
  - https://pkg.go.dev/time#Time
  - https://pkg.go.dev/time#Time.AddDate
  - https://pkg.go.dev/time#pkg-constants
---
- **== on time.Time**: `t1 == t2`, `time.Time` map keys and `reflect.DeepEqual` also compare location and monotonic reading → the same instant differs after JSON/DB round trips. Fix: `t1.Equal(t2)`; keys via `t.UTC()`.
- **Duration units**: `time.Duration(cfg.TimeoutSeconds)` or `time.Sleep(100)` mean nanoseconds → timeouts fire instantly, retries spin. Fix: `time.Duration(n) * time.Second`.
- **Layout typos**: layouts use the reference `2006-01-02 15:04:05 -0700`; `YYYY-MM-DD`, `2006-02-01` (day/month swapped) or `03` without `PM` mis-format or mis-parse, often only on days above 12. Fix: `time.DateOnly`, `time.RFC3339`.
- **Missing location**: `time.Parse` without a zone yields UTC; user/DB wall-clock times need `time.ParseInLocation`; `time.Local` differs per host (TZ) → day boundaries shift by hours.
- **Calendar arithmetic**: `AddDate(0, 1, 0)` normalises (Jan 31 + 1 month → early March); `Truncate(24*time.Hour)` rounds to a UTC day, not local midnight. Fix: `time.Date(y, m, d, 0, 0, 0, 0, loc)`.
- **Units and zero time**: `time.Unix(ms, 0)` with JavaScript milliseconds lands in year ~50,000 (use `UnixMilli`); an unset `time.Time` (missing field, NULL scan) is year 1 → treated as long expired, or as "never expires" where zero is special-cased.
