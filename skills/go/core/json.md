---
name: encoding/json (v1 API)
description: encoding/json pitfalls — silently dropped fields and tag typos, omitempty on structs and time, float64 numbers in any, merging into reused values, null slices, trailing data and pointer-receiver marshalers.
priority: 56
tags: [CWE-20]
activation:
  content:
    - '\bjson\.(?:Marshal\w{0,6}|Unmarshal|NewDecoder|NewEncoder|Number|RawMessage)\b'
    - '\bjson:"'
    - '\b(?:Marshal|Unmarshal)JSON\b'
sources:
  - https://pkg.go.dev/encoding/json#Marshal
  - https://pkg.go.dev/encoding/json#Unmarshal
  - https://go.dev/doc/go1.24
  - https://go.dev/doc/go1.27
---
- **Silent field loss**: unexported fields are skipped and tags that don't match the wire names (`json:"user_id"` vs `userId`) just leave zero values → data silently dropped on decode or never sent. Fix: round-trip tests with real payloads.
- **Empty values**: `omitempty` never omits structs or `time.Time` yet drops meaningful `0`/`false`; nil slices/maps encode as `null` → clients expecting `[]` break. Fix: `omitzero` (Go 1.24+), pointers, `[]T{}`.
- **Numbers in any**: decoding into `any`/`map[string]any` makes numbers `float64` → IDs above 2^53 corrupt, `.(int)` assertions fail. Fix: typed structs or `Decoder.UseNumber`.
- **Merge into existing values**: `Unmarshal` into a non-nil map keeps old keys, into a reused struct keeps fields absent from the input → stale data leaks between requests. Fix: decode into a fresh value.
- **Trailing data**: `NewDecoder(r).Decode(&v)` reads only the first value and ignores what follows (`{…}garbage`). Fix: require a second `Decode` to return `io.EOF`.
- **Pointer-receiver marshalers**: `func (t *T) MarshalJSON` is skipped for non-addressable `T` values (map values, by-value fields) → default encoding leaks fields. Fix: value receivers.
- **Error text (Go 1.27)**: encoding/json runs on the v2 engine and messages changed → `err.Error()` matching breaks. Fix: `errors.As` with `*json.SyntaxError`/`*json.UnmarshalTypeError`.
