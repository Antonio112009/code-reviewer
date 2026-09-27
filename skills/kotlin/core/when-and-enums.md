---
name: Sealed hierarchies, when and enums
description: Defects in sealed/enum modelling — else branches hiding new cases, valueOf on external strings, persisted ordinals and names, per-call values() arrays, and plain objects that stop matching after deserialization.
priority: 55
tags: [CWE-478, CWE-704]
activation:
  content:
    - '\belse\s*->'
    - '\bsealed\s+(?:class|interface)\b'
    - '\benum\s+class\b'
    - '\.(?:ordinal|valueOf)\b'
    - '\benumValueOf\s*<'
    - '\bvalues\(\)'
sources:
  - https://kotlinlang.org/docs/sealed-classes.html#use-sealed-classes-with-when-expression
  - https://kotlinlang.org/docs/enum-classes.html
  - https://kotlinlang.org/docs/object-declarations.html#data-objects
---
- **`else` on sealed/enum `when`**: an `else` branch turns off exhaustiveness → a newly added subclass or constant silently takes the default path. Fix: list every case, no `else`.
- **valueOf on external input**: `Enum.valueOf(s)`/`enumValueOf<T>(s)` throw `IllegalArgumentException` for unknown values from APIs, DB, prefs or deep links → crash when the server adds a value. Fix: `entries.firstOrNull { it.name == s }` with an UNKNOWN fallback.
- **Persisted ordinal**: `ordinal` stored in DB columns, prefs, Room converters or intent extras → reordering or inserting constants remaps stored data silently. Fix: store a stable explicit code.
- **Renamed constants**: enum `name` used as a DB/JSON/prefs value → renaming a constant breaks stored data and old clients. Fix: explicit serial names (`@SerialName`, `@SerializedName`) or codes.
- **values() allocation**: `values()` copies the array on every call (hot loops, adapters) → garbage. Fix: `entries` (Kotlin 1.9+).
- **Plain objects after deserialization**: Gson, Java serialization or reflection can create a second instance of a plain `object` → `==` and `when (x) { Loading -> }` stop matching. Fix: `data object` (1.9+) or `is` checks.
