---
name: Null safety and platform types
description: Holes in Kotlin null safety — Java platform types, `!!` on external data, unchecked generic casts, `?.let … ?:` chains that run both branches and `null` silently turned into the string "null".
priority: 58
tags: [CWE-476, CWE-704]
activation:
  content:
    - '!!'
    - '\bas\??\s+(?:List|Map|Set|Collection|Iterable|Mutable\w+|Array|Pair)<'
    - '\bas\??\s+T\b'
    - '\?\.(?:let|run)\s*\{'
    - '\?:\s*(?:return|throw|continue|break)\b'
sources:
  - https://kotlinlang.org/docs/java-interop.html#null-safety-and-platform-types
  - https://kotlinlang.org/docs/null-safety.html
  - https://kotlinlang.org/docs/typecasts.html#unchecked-casts
  - https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/to-string.html
---
- **Platform types**: a Java return value (`T!`) kept in an inferred `val` or passed along unchecked → NPE far from the call. Fix: give Java results an explicit Kotlin type (`String?`) at the boundary.
- **`!!` on external data**: `!!` on request parameters, intent extras, JSON fields, `map[key]`, `findViewById` or DB columns → crash on the first missing value. Fix: handle null (`?: return`, domain error); keep `!!` for true invariants.
- **Unchecked casts**: `x as List<String>` / `as T` checks only the erased class → `ClassCastException` later where an element is used. Fix: `filterIsInstance<String>()`, reified type checks.
- **`?.let { … } ?: fallback`**: the fallback also runs when the `let` block itself evaluates to null (e.g. last call returns `T?`) → both branches execute. Fix: `if (x != null) … else …`.
- **"null" strings**: `x.toString()` and `"$x"` on a nullable value produce the text `"null"` → stored in DB, sent in URLs/headers or shown in UI. Fix: `x ?: default` or `x.orEmpty()` before formatting.
