---
name: Clocks and time arithmetic
description: Time handling in C/C++ — wall clocks used for intervals, high_resolution_clock, duration_cast truncation and unit mix-ups, clock() measuring CPU time, 32-bit time_t (Y2038) and mktime DST handling.
priority: 55
tags: [CWE-682, CWE-190]
activation:
  content:
    - '\bstd::chrono::|\b(?:system_clock|steady_clock|high_resolution_clock|duration_cast|time_point)\b'
    - '\b(?:time|clock|gettimeofday|clock_gettime|mktime|timegm|difftime)\s*\('
    - '\b(?:time_t|CLOCK_(?:REALTIME|MONOTONIC)\w*|CLOCKS_PER_SEC|_TIME_BITS)\b'
  examples:
    - 'auto start = std::chrono::steady_clock::now();'
    - 'time_t now = time(NULL);'
sources:
  - https://en.cppreference.com/w/cpp/chrono/high_resolution_clock
  - https://en.cppreference.com/w/c/chrono/clock
  - https://man7.org/linux/man-pages/man3/mktime.3.html
  - https://sourceware.org/glibc/manual/latest/html_node/Feature-Test-Macros.html
---
- **Wall clock for durations**: `time()`, `gettimeofday`, `CLOCK_REALTIME` or `system_clock` used for timeouts or elapsed time → clock steps (NTP, manual) give negative durations, early or stuck timeouts. Fix: `CLOCK_MONOTONIC` / `steady_clock`.
- **high_resolution_clock**: an alias of `system_clock` in libstdc++, so it can jump backwards. Fix: `steady_clock` for measurements.
- **duration_cast truncation**: rounds toward zero (1999 ms → 1 s; short timeouts → 0 → busy loops); `.count()` passed to APIs expecting another unit. Fix: C++17 `floor`/`ceil`/`round`; typed durations up to the API.
- **clock() is CPU time**: processor time of the whole process, not elapsed time — sleeps and I/O vanish, threads inflate it; a 32-bit `clock_t` wraps in ~36 minutes. Fix: monotonic clocks.
- **Y2038**: `time_t` is still 32-bit on some glibc targets (i686, 32-bit ARM) without `_TIME_BITS=64` (+ `_FILE_OFFSET_BITS=64`); timestamps kept in `int`, `long` (32-bit on Windows) or 32-bit fields overflow in 2038. Fix: 64-bit types end to end.
- **mktime and DST**: `tm_isdst` left 0 or uninitialized shifts results by an hour around DST changes; `mktime` reads local time. Fix: `tm_isdst = -1`; `timegm` for UTC.
