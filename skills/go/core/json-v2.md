---
name: encoding/json/v2 migration (Go 1.25 experiment, Go 1.27)
description: Behaviour changes when code moves to encoding/json/v2 or jsontext — case-sensitive names, [] for nil, redefined omitempty, stricter input, new encodings for byte arrays and durations, unsorted map keys.
priority: 60
tags: [CWE-436]
activation:
  versions: { lang.go: '>=1.25' }
  content:
    - 'encoding/json/(?:v2|jsontext)'
    - '\bjsontext\.'
    - '\bjson\.(?:MarshalWrite|MarshalEncode|UnmarshalRead|UnmarshalDecode|DefaultOptionsV1|MatchCaseInsensitiveNames|FormatNilSliceAsNull|FormatNilMapAsNull)\b'
  examples:
    - 'import "encoding/json/v2"'
    - 'dec := jsontext.NewEncoder(w)'
    - 'json.MarshalWrite(w, v, json.DefaultOptionsV1())'
sources:
  - https://go.dev/doc/go1.27
  - https://pkg.go.dev/encoding/json/v2
  - https://github.com/golang/go/blob/master/src/encoding/json/v2_diff_test.go
---
- **Case-sensitive names**: v2 matches object keys exactly; clients sending `userId` for `json:"userID"` (accepted by v1) now leave the field zero silently. Fix: exact tags, or `MatchCaseInsensitiveNames(true)` for compatibility.
- **nil encodes as empty**: nil slices/maps marshal as `[]`/`{}` instead of `null` → API contract and golden files change. Fix: `FormatNilSliceAsNull`/`FormatNilMapAsNull` where clients rely on null.
- **omitempty redefined**: v2 omits only empty JSON values (`null`, `""`, `{}`, `[]`), so `0`/`false` fields dropped by v1 are now sent. Fix: `omitzero` for Go zero values.
- **Stricter input**: duplicate names, invalid UTF-8 and JSON arrays whose length differs from a Go array are errors → payloads v1 accepted now fail with 400s. Fix: decide per endpoint; add tests.
- **Changed encodings**: `[N]byte` becomes base64, `time.Duration` a duration string (not nanoseconds), `string` tag option applies only to numbers, map keys are no longer sorted → consumers, caches and signatures over output break.
- **Merge and methods**: `null` now clears values and objects merge per RFC 7396; pointer-receiver marshal methods are always called → unmarshaling into prefilled structs and output of value types change.
