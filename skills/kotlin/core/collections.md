---
name: Collections pitfalls
description: Kotlin collection traps — read-only views that still change, discarded results of non-mutating operations, silent key collisions, throwing accessors, modification during iteration, removeFirst/removeLast on older runtimes and one-shot sequences.
priority: 56
tags: [CWE-248, CWE-662]
activation:
  content:
    - '\.(?:associateBy|associateWith|associate|toMap)\s*[({]'
    - '\.(?:first|last|single|reduce|getValue|elementAt|max|min|maxOf|minOf)\s*[({]'
    - '\.(?:removeFirst|removeLast)\s*\('
    - '\.(?:sorted|sortedBy|sortedDescending|sortedWith|reversed|shuffled|distinct|plus|minus|filterNot|trim)\s*[({]'
    - '\b(?:asSequence|generateSequence|constrainOnce)\s*[({]'
    - '\.(?:remove|removeAt|removeAll|removeIf)\s*[({]'
    - '\bMutableList<|\bmutableListOf\s*[<(]'
sources:
  - https://kotlinlang.org/docs/collections-overview.html
  - https://kotlinlang.org/docs/whatsnew23.html#unused-return-value-checker
  - https://kotlinlang.org/docs/compatibility-guide-21.html#change-map-entry-behavior-to-fail-fast-on-structural-modification
  - https://developer.android.com/about/versions/15/behavior-changes-15
---
- **Read-only is not immutable**: a `List` backed by a `MutableList` field changes under callers or is cast back and mutated → stale data, `ConcurrentModificationException`. Fix: expose copies.
- **Discarded results**: `sorted()`, `reversed()`, `distinct()`, `plus()`, `trim()` return new values; as statements they do nothing. Fix: use the result or in-place `sort()`; Kotlin 2.3 `-Xreturn-value-checker` flags it.
- **Silent collisions**: `associateBy`/`toMap` keep the last element per key → duplicate IDs dropped. Fix: `groupBy` or check sizes.
- **Throwing accessors**: `first()`, `single()`, `max()`/`min()` (non-null since 1.7), `reduce`, `getValue` throw on empty/missing input → crash on empty API or DB results. Fix: `firstOrNull()`, `maxOrNull()`, `getOrElse`.
- **Mutation during iteration**: `remove` inside `for`/`forEach`, or map writes while iterating (on Native/JS/Wasm a stale `Map.Entry` throws since 2.1) → `ConcurrentModificationException`. Fix: `removeAll {}`, iterator `remove()`.
- **removeFirst/removeLast**: built against JDK 21+ or Android `compileSdk 35+`, they bind to new Java `List` methods → `NoSuchMethodError` on older JVMs / Android ≤ 14. Fix: `removeAt(0)`, `removeAt(lastIndex)`.
- **One-shot sequences**: `iterator.asSequence()` and seedless `generateSequence {}` iterate once → `IllegalStateException` on a second terminal call. Fix: `toList()`.
