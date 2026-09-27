---
name: Initialization order, lateinit and lazy
description: Object-construction traps — open members called from base constructors, declaration-order dependencies, lateinit read too early, lazy thread-safety modes and retries, object/companion initializer failures and inlined const val values.
priority: 56
tags: [CWE-457, CWE-665]
activation:
  content:
    - '\bby\s+lazy\b'
    - '\bLazyThreadSafetyMode\b'
    - '\blateinit\s+var\b'
    - '\binit\s*\{'
    - '\bcompanion\s+object\b'
    - '^\s*(?:(?:private|internal|public)\s+)?object\s+\w+'
    - '\b(?:open|abstract)\s+(?:val|var|fun)\b'
    - '\bconst\s+val\b'
sources:
  - https://kotlinlang.org/docs/inheritance.html#derived-class-initialization-order
  - https://kotlinlang.org/docs/properties.html#late-initialized-properties-and-variables
  - https://kotlinlang.org/docs/delegated-properties.html#lazy-properties
  - https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html#jls-12.4.2
---
- **Open member in constructor**: a base-class `init` or property initializer calls an `open`/abstract member → it runs before the subclass's properties are set → `null` in non-null types, NPE. Fix: no open calls during construction; pass values in.
- **Declaration order**: initializers and `init` blocks run top to bottom → code reading a property declared further down (often through a function) sees `null`/0. Fix: reorder or use `by lazy`.
- **lateinit too early**: `lateinit var` read on a path that can run before assignment (callbacks before `onCreate`, another thread, field injection used in `init`) → `UninitializedPropertyAccessException`. Fix: constructor injection, nullable type or `::x.isInitialized`.
- **lazy modes**: `LazyThreadSafetyMode.NONE` shared across threads → double initialization or torn state; `PUBLICATION` may run the initializer several times (duplicate side effects). Fix: default `SYNCHRONIZED` for shared state.
- **lazy retries**: if the initializer throws, every later access runs it again → repeated expensive failures. Fix: cache the failure or initialize eagerly with handling.
- **object/companion init failure**: an exception in an `object` or companion initializer gives `ExceptionInInitializerError`, then `NoClassDefFoundError` on every later access until restart. Fix: keep initializers trivial.
- **Inlined `const val`**: dependents compile the value in → changing a library's `const val` does not reach already-built modules. Fix: `val` for values that may change.
