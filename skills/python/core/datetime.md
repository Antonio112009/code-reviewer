---
name: Dates, times and time zones
description: Naive "UTC" from utcnow (deprecated 3.12), naive/aware mixing, pytz tzinfo= LMT offsets, DST in same-zone arithmetic, wall-clock durations, strptime without a year (error in 3.15), fromisoformat before 3.11 and date/datetime confusion.
priority: 60
activation:
  content:
    - "\\b(?:datetime|zoneinfo|ZoneInfo|pytz|dateutil|tzinfo|timedelta)\\b"
    - "\\b(?:strptime|fromisoformat|fromtimestamp|utcfromtimestamp|utcnow|astimezone|localize)\\s*\\("
    - "\\btime\\.time\\s*\\("
sources:
  - https://docs.python.org/3/library/datetime.html#aware-and-naive-objects
  - https://docs.python.org/3/library/datetime.html#datetime.datetime.strptime
  - https://pythonhosted.org/pytz/#localized-times-and-date-arithmetic
  - https://docs.python.org/3/library/zoneinfo.html
---
- **Naive "UTC"**: `utcnow()`/`utcfromtimestamp()` (deprecated 3.12) return naive values that `.timestamp()`/`.astimezone()` treat as local time → hours-off instants unless the server runs in UTC. Fix: `datetime.now(timezone.utc)`.
- **Naive vs aware**: `<` and `-` between them raise TypeError, while `==` just returns False → matches silently never happen. Fix: normalize to aware UTC at the boundary.
- **pytz `tzinfo=`**: `datetime(..., tzinfo=pytz.timezone("Europe/Berlin"))` uses the historical LMT offset (+00:53) → wrong instants. Fix: `zoneinfo.ZoneInfo`, or `tz.localize()`.
- **Same-zone arithmetic ignores DST**: `dt + timedelta(hours=24)` and subtracting datetimes sharing one `ZoneInfo` are wall-clock math → off by an hour across DST. Fix: compute durations in UTC.
- **Wall clock for durations**: `time.time()` jumps with clock changes → bogus timeouts. Fix: `time.monotonic()`.
- **No year in `strptime`**: `"%m-%d"` parses into 1900, so Feb 29 fails (DeprecationWarning 3.13, ValueError in 3.15). Fix: add an explicit leap year.
- **`fromisoformat` before 3.11**: rejects `Z` and most ISO 8601 forms → ValueError on API timestamps. Fix: 3.11+, or replace `"Z"` with `"+00:00"`.
- **`date` vs `datetime`**: `isinstance(x, date)` accepts datetimes; `date == datetime` is always False. Fix: check `datetime` first.
