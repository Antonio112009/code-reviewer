---
name: Dates, time and money
description: Time-zone, DST, calendar, clock and unit bugs and format-token slips, plus float money, decimal, rounding, currency and amount-validation defects.
category: practice
priority: 55
tier: essential
tags:
  - CWE-1339
  - CWE-681
  - CWE-190
  - CWE-20
activation:
  languages:
    - typescript
    - javascript
    - python
    - php
    - java
    - kotlin
    - csharp
    - go
    - rust
    - c
    - cpp
    - ruby
    - swift
    - scala
    - dart
    - elixir
    - objective-c
    - vue
    - svelte
    - groovy
    - sql
  content:
    - \bnew Date\(|\bDate\.(?:now|parse|UTC)\(|\.(?:get|set)(?:UTC)?(?:FullYear|Month|Date|Day|Hours)\(|\bgetTimezoneOffset\(|\btoISOString\(|\bTemporal\.|\bIntl\.DateTimeFormat\b
    - (?:from\s+|require\(\s*)['"](?:dayjs|moment(?:-timezone)?|luxon|date-fns(?:-tz)?|@date-fns/\w+)['"]
    - \bdatetime\.(?:now|utcnow|today|fromtimestamp|utcfromtimestamp|strptime|combine)\(|\btimedelta\(|\b(?:zoneinfo|pytz|relativedelta|freezegun|time\.time\(\))|\bfrom\s+datetime\s+import\b
    - \b(?:LocalDate|LocalDateTime|ZonedDateTime|OffsetDateTime|Instant|ZoneId|DateTimeFormatter|SimpleDateFormat|ChronoUnit|DateFormatter)\b|\bCalendar\.getInstance\(|\bDateTime(?:Offset)?\.(?:Now|UtcNow|Today|Parse|ParseExact)\b|\b(?:TimeZoneInfo|DateOnly|TimeProvider)\b|\bSystem\.currentTimeMillis\(
    - \btime\.(?:Now|Parse|ParseInLocation|Unix|UnixMilli|Date|LoadLocation)\(|\.Format\("(?:2006|Jan|Mon|15:04)|\b(?:chrono::|Utc::now|Local::now|NaiveDate(?:Time)?|jiff::)
    - \b(?:Carbon|CarbonImmutable)::|\bstrtotime\(|\bDateTimeImmutable\b|\bTime\.(?:now|zone|current)\b|\bDate\.today\b|\.(?:days|hours|months)\.(?:ago|from_now)\b
    - \b(?:timestamptz|AT TIME ZONE|CURRENT_TIMESTAMP|CURRENT_DATE|date_trunc|DATE_TRUNC)\b|\bNOW\(\)|\bINTERVAL\s+'
    - \b(?:BigDecimal|RoundingMode|MathContext|ROUND_HALF_\w+|Money|MonetaryAmount|NumberFormat\.getCurrencyInstance)\b|\bDecimal\(|\bdecimal\.Decimal\b|\.toFixed\(|\bcurrency\b
    - \b(?:\w+_)?(?:price|amount|balance|subtotal|tax|vat|discount|refund|fee|cents)s?\b\s*[-+*/]=?\s*[\w(]|\b\w+(?:Price|Amount|Balance|Subtotal|Tax|Discount|Refund|Fee|Cents)s?\b\s*[-+*/]=?\s*[\w(]
    - \b(?:[Pp]rice|[Aa]mount|[Bb]alance|[Tt]otal|[Cc]ost|[Ff]ee)\w*\??\s*(?::\s*)?(?:float|double|number|Float|Double|float32|float64|f32|f64|REAL|FLOAT|DOUBLE)\b|\b(?:double|float|Double|Float)\s+(?:[Pp]rice|[Aa]mount|[Bb]alance|[Tt]otal|[Cc]ost|[Ff]ee)
  examples:
    - 'const created = new Date();'
    - 'import dayjs from "dayjs";'
    - 'now = datetime.utcnow()'
    - 'Instant now = Instant.now();'
    - 'now := time.Now()'
    - 'Carbon::now()->addDays(3);'
    - 'SELECT NOW(), CURRENT_TIMESTAMP;'
    - 'BigDecimal total = price.setScale(2, RoundingMode.HALF_UP);'
    - 'const total = order.subtotal + order.tax;'
    - 'double price = 9.99;'
---
- **Naive times**: `datetime.now()`/`utcnow()`, `LocalDateTime`, `DateTime.Now` or SQL `timestamp` without zone stored or compared across zones; `utcnow().timestamp()` read as local → shifted instants, naive/aware errors. Fix: aware UTC instants, `timestamptz`.
- **Implicit zone**: JS parses `"2026-03-01"` as UTC but `"2026-03-01T00:00"` as local; `getDate()` mixed with `getUTC*`; `toISOString().slice(0, 10)` or server-zone "today" for users elsewhere → off-by-one days. Fix: explicit zones.
- **Calendar arithmetic**: "tomorrow" as `+86400` seconds, `setMonth(m + 1)` on Jan 31, leap days, local schedules inside DST gaps or overlaps → wrong dates, skipped or doubled jobs. Fix: zone-aware calendar APIs.
- **Clocks and units**: seconds vs milliseconds (JWT `exp`, Unix timestamps in `new Date()`), durations scaled twice, elapsed time or timeouts measured with wall clocks → expiries 1000× off, negative intervals. Fix: typed durations, monotonic clocks.
- **Format tokens**: `YYYY` (week year) or `DD` (day of year) in Java or Swift patterns, `hh`/`HH`, `mm`/`MM`, Python `%M`/`%m` → wrong dates near New Year, wrong times. Fix: check the library's tokens.
- **Float money**: `float`, `double` or JS `number` amounts (`(1.005).toFixed(2)` gives `"1.00"`), `BigDecimal` built from a double, `BigDecimal.equals` comparing scale, Python `round()` half-to-even → cent drift, failed comparisons. Fix: minor units, decimals from strings, `compareTo`.
- **Allocation**: rounding per line vs on the total, splits losing remainder cents, int32 cents overflow, assumed two decimals (JPY 0, KWD 3), mixed currencies summed → unreconciled totals. Fix: one rounding rule, ISO 4217 exponents.
- **Unvalidated amounts**: negative, zero, NaN or over-precise amounts and quantities accepted; refunds or discounts exceeding the original → money created, charges reversed. Fix: validate sign, scale and bounds server-side.
