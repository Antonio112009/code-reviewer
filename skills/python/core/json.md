---
name: JSON encoding and decoding
description: json module traps — NaN/Infinity emitted by default, non-string keys coerced, default=str hiding types, float precision on load, duplicate keys (last wins), unbounded input and ensure_ascii/encoding mismatches.
priority: 54
activation:
  content:
    - "\\bjson\\.(?:loads?|dumps?)\\s*\\("
    - "\\bJSON(?:En|De)coder\\b|\\b(?:object_pairs_hook|parse_float|allow_nan|ensure_ascii)\\s*="
    - "\\b(?:orjson|ujson|simplejson)\\b"
  examples:
    - 'payload = json.dumps(data)'
    - 'data = json.loads(body, parse_float=Decimal)'
    - 'import orjson'
sources:
  - https://docs.python.org/3/library/json.html#json.dumps
  - https://docs.python.org/3/library/json.html#repeated-names-within-an-object
  - https://docs.python.org/3/library/json.html#json.loads
  - https://docs.python.org/3/library/stdtypes.html#int-max-str-digits
---
- **Non-standard NaN/Infinity**: `json.dumps` writes `NaN`/`Infinity` by default (`allow_nan=True`) → JavaScript, Go and PostgreSQL `jsonb` reject the payload. Fix: `allow_nan=False` and clean floats first.
- **Keys become strings**: int, float, bool and None keys are coerced to strings (`{1: …}` → `{"1": …}`), tuple keys raise TypeError → `loads(dumps(d)) != d`, int lookups miss. Fix: convert keys back explicitly after loading.
- **`default=str` hides types**: it silently turns Decimal, datetime, UUID, sets, bytes and arbitrary objects into `str()` output → broken API contracts, leaked object reprs. Fix: a `default` for known types that raises TypeError otherwise.
- **Precision on load**: numbers become `float` → money loses cents precision; ints above 2^53 are already rounded by JavaScript clients. Fix: `parse_float=Decimal`; send ids and amounts as strings.
- **Duplicate keys**: `{"role": "user", "role": "admin"}` loads as the last value → validators or proxies reading the first value disagree with this code. Fix: `object_pairs_hook` that rejects duplicates for security-relevant input.
- **Unbounded input**: no size or depth limits — deep nesting raises RecursionError, huge bodies exhaust memory, and 4300+ digit integers raise ValueError. Fix: cap request size before `loads`; catch `ValueError`/`RecursionError`.
- **`ensure_ascii=False` output**: writing non-ASCII JSON to a file opened without `encoding="utf-8"` raises UnicodeEncodeError on non-UTF-8 locales (Windows before 3.15). Fix: pass the encoding.
