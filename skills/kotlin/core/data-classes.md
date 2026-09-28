---
name: Data class semantics
description: Generated equals/hashCode/toString/copy of data classes — body properties ignored, arrays compared by identity, mutable keys, shallow copies, exposed private constructors, secrets in toString and positional destructuring.
priority: 58
tags: [CWE-532, CWE-697]
activation:
  content:
    - '\bdata\s+class\b'
    - '\.copy\s*\('
    - '\b(?:val|var)\s*\(\s*\w+\s*,'
  examples:
    - 'data class User(val id: Int, val name: String)'
    - 'val updated = user.copy(name = "New")'
    - 'val (id, name) = user'
sources:
  - https://kotlinlang.org/docs/data-classes.html
  - https://kotlinlang.org/docs/whatsnew2020.html#data-class-copy-function-to-have-the-same-visibility-as-constructor
  - https://kotlinlang.org/docs/destructuring-declarations.html
---
- **Body properties ignored**: only primary-constructor properties take part in `equals`/`hashCode`/`toString`/`copy` → objects that differ in a body `var` compare equal (`distinct()`, `DiffUtil`, `StateFlow` drop the update) and `copy()` resets it. Fix: move state into the constructor.
- **Array properties**: `Array`/`ByteArray` members compare by reference in generated `equals` → equal contents never match. Fix: use `List`, or override with `contentEquals`/`contentHashCode`.
- **Mutable keys**: a data class with `var` properties used as a `HashMap`/`HashSet` key and mutated later → entry becomes unreachable. Fix: `val`-only keys.
- **Shallow copy**: `copy()` shares nested mutable lists/objects → editing the copy mutates the original (undo, cached or previous UI state). Fix: immutable collections or explicit deep copy.
- **Private constructor exposed**: a `private constructor` guarded by a validating factory still gets a public `copy()` that builds unvalidated instances. Fix: `@ConsistentCopyVisibility` (Kotlin 2.0.20+) or validate in `init`.
- **Secrets in toString**: generated `toString()` prints every constructor property → passwords, tokens, PII in logs, crash reports and exception messages. Fix: override `toString` or wrap secrets in a type with a redacted `toString`.
- **Positional destructuring**: `val (id, name) = user` binds by position → reordering or inserting constructor parameters silently swaps values at every call site. Fix: access properties by name for evolving classes.
