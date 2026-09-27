---
name: JSON encoding and decoding
description: json_decode/json_encode traps — null for both invalid JSON and "null", stdClass vs arrays, false on invalid UTF-8/NAN, big integers turned into floats, and lost float zero fractions.
priority: 57
tags: [CWE-252, CWE-681]
activation:
  content:
    - '\bjson_(?:encode|decode|validate)\s*\('
    - '\bJSON_(?:THROW_ON_ERROR|BIGINT_AS_STRING|OBJECT_AS_ARRAY)\b'
sources:
  - https://www.php.net/manual/en/function.json-decode.php
  - https://www.php.net/manual/en/function.json-encode.php
  - https://www.php.net/manual/en/json.constants.php
---
- **Ambiguous null**: `json_decode` returns `null` for malformed input, for the literal `null` and past `depth` (512) → broken bodies look like "no data" and pass through. Fix: `JSON_THROW_ON_ERROR`, or `json_validate()` (8.3).
- **stdClass vs array**: without `true` as the second argument the result is `stdClass`, so `$data['key']` throws `Error`; with `true`, `{}` and `[]` both decode to `[]` and re-encode as `[]` → an API that expects an object breaks.
- **Encode returns false**: invalid UTF-8 (often from byte-wise `substr`), `NAN`/`INF` or recursion make `json_encode` return `false` → an empty body or `false` is stored. Fix: `JSON_THROW_ON_ERROR`, `JSON_INVALID_UTF8_SUBSTITUTE`.
- **Big integers**: numbers above `PHP_INT_MAX` decode as floats and lose digits; JavaScript clients also lose precision above 2^53 → wrong IDs. Fix: `JSON_BIGINT_AS_STRING`, send IDs as strings.
- **Floats**: `10.0` encodes as `10` (clients see an int) unless `JSON_PRESERVE_ZERO_FRACTION`; `0.1 + 0.2` encodes as `0.30000000000000004` → send money as strings or minor units.
