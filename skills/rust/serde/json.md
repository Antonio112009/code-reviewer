---
name: serde_json pitfalls
description: serde_json behaviour that corrupts or leaks data — NaN/inf written as null, non-string map keys failing at runtime, 64-bit integers for JavaScript clients, absent vs null in PATCH bodies, unbounded input and raw JSON inside HTML.
priority: 56
tags: [CWE-681, CWE-400, CWE-79]
activation:
  content:
    - '\bserde_json\b|\bjson!\s*\('
    - '\bOption<Option<'
    - '\bdisable_recursion_limit\b|\bunbounded_depth\b|\barbitrary_precision\b'
sources:
  - https://docs.rs/serde_json/latest/serde_json/fn.to_string.html
  - https://docs.rs/serde_json/latest/serde_json/struct.Deserializer.html#method.disable_recursion_limit
  - https://docs.rs/serde_with/latest/serde_with/rust/double_option/index.html
---
- **Non-finite floats**: NaN and ±infinity serialize as `null`, and deserializing that `null` back into `f64` fails → broken round trips and consumers. Fix: validate `is_finite()` or model as `Option<f64>`.
- **Non-string map keys**: maps keyed by structs, tuples or enums with data fail at runtime with "key must be a string"; integer keys become strings. Fix: string keys or a `Vec` of pairs.
- **64-bit integers for JavaScript**: IDs above 2^53 lose precision in `JSON.parse` → wrong records. Fix: serialize such IDs as strings.
- **Absent vs `null`**: `Option<T>` cannot distinguish a missing field from `null`, so PATCH handlers either clear fields by accident or cannot clear them. Fix: `Option<Option<T>>` with `serde_with::rust::double_option`.
- **Untrusted input**: `from_slice`/`from_reader` without a body-size cap; disabling the 128-level recursion limit (`unbounded_depth`) → stack overflow on nested input. Fix: cap sizes, keep the limit.
- **JSON inside HTML**: `serde_json::to_string` output inlined into `<script>` does not escape `</script>` → XSS. Fix: escape `<`, `>`, `&` (e.g. `<` as `\u003c`) or deliver via a data attribute/separate request.
