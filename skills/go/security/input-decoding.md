---
name: Decoding untrusted input (binding, parser differentials, numbers)
description: Mass assignment through JSON/form binding into models, encoding/json case-insensitive and duplicate-key differentials, tag mistakes exposing fields, integer narrowing after strconv and NaN/Inf from ParseFloat.
priority: 76
tags: [CWE-915, CWE-436, CWE-190, CWE-681]
activation:
  content:
    - '\bjson\.(?:Unmarshal|NewDecoder)\b'
    - '\.(?:Bind|BindJSON|ShouldBind\w{0,12}|BodyParser|Decode)\('
    - '\bstrconv\.(?:Atoi|ParseInt|ParseUint|ParseFloat)\b'
    - '\bu?int(?:8|16|32)\('
    - '\b(?:xml|yaml)\.(?:Unmarshal|NewDecoder)\b'
    - 'json:"(?:-,|omitempty)'
sources:
  - https://blog.trailofbits.com/2025/06/17/unexpected-security-footguns-in-gos-parsers/
  - https://pkg.go.dev/encoding/json#Unmarshal
  - https://codeql.github.com/codeql-query-help/go/go-incorrect-integer-conversion/
  - https://pkg.go.dev/strconv#ParseFloat
---
- **Mass assignment**: decoding request bodies (`json.Decode`, Gin/Echo/Fiber binding) straight into DB models lets clients set any exported field — `ID`, `Role`, `IsAdmin`, `OwnerID`, `Balance`. Fix: request DTOs with only writable fields, copied explicitly.
- **Parser differentials (v1)**: encoding/json matches keys case-insensitively and keeps the last duplicate → `{"role":"user","ROLE":"admin"}` passes a gateway/validator that read `role` while Go sees `admin`. Fix: validate the decoded struct; reject duplicates (json/v2 default).
- **Tag mistakes**: `json:"-,"` still binds key `"-"`; `json:"omitempty"` renames the key; secret fields (password hashes, tokens) without `json:"-"` leak in responses. Fix: correct tags; separate response types.
- **Integer narrowing**: `strconv.Atoi`/`ParseInt(s, 10, 64)` results cast to `int32`, `uint16`, `uint32` or used as sizes/offsets → wraparound bypasses limits, negative lengths panic. Fix: `ParseInt(s, 10, 32)`/`ParseUint` with bitSize plus range checks.
- **NaN and Inf**: `strconv.ParseFloat` accepts `NaN`, `Inf` and huge exponents; NaN fails every comparison, so `if amount <= 0 { reject }` lets it through. Fix: `math.IsNaN`/`IsInf` checks; decimals for money.
- **Lenient XML/YAML**: `encoding/xml` skips leading/trailing garbage (JSON/XML polyglots) and unknown fields are ignored everywhere. Fix: dispatch on Content-Type; `DisallowUnknownFields`, yaml `KnownFields(true)` where strictness matters.
