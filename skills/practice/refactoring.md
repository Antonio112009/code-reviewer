---
name: Moved and rewritten code
description: Slips in changes that move, split, rewrite or rewire existing code — guards lost in a move, odd hunks in bulk rewrites, best-effort steps made blocking, mismatched feature gates, lookups keyed differently from writes, results computed and dropped, and dead fallbacks.
category: practice
priority: 90
tier: essential
activation:
  languages:
    - typescript
    - javascript
    - python
    - php
    - java
    - kotlin
    - csharp
    - go
    - rust
    - c
    - cpp
    - ruby
    - swift
    - scala
    - dart
    - elixir
    - objective-c
    - vue
    - svelte
    - groovy
---
- **Lost in the move**: code moved or split into a new function, class, middleware or file drops what the old path did — a null or empty guard its siblings keep, an error check, a permission check, a log or trace field, a header, a metric label → crashes or silent regressions on inputs the old code handled. Fix: map every removed line to its new home.
- **Mechanical rewrites**: a bulk edit (rename, API migration, values wrapped in a new helper) where a few of many identical hunks change the old value, swap argument order or break their siblings' pattern → regressions hidden among dozens of correct hunks. Fix: check each rewritten line keeps its old value in its old slot.
- **Best-effort made blocking**: a side effect that was async, deferred or log-only (telemetry, tagging, cache warm-up, audit) moved inline or its error now propagated → its latency and failures now slow or fail the main request. Fix: keep it non-fatal, or make fail-closed deliberate and tested.
- **Inconsistent gates**: a block guarded by a different feature flag, version or mode than its siblings or than the code that creates the state it handles (a v1 flag on a v2 path, cleanup gated on one of two flags) → it runs in the wrong configuration or never, leaving orphaned data. Fix: gate on the producer's condition.
- **Lookup key ≠ write key**: a find by name, owner or key built from other fields than the write that stored the record (`client.getId()` vs `clientId`, raw vs normalized, server id vs owner id) → never matches; silent fallback to a default path. Fix: one key-building helper; test the round trip.
- [full] **Computed but unused**: a copy or transformed value is built, then the original is used or returned (`cfg = dict(x.config); cfg[k] = v; return x.config`) → the change silently never applies. Fix: use the result; drop dead locals.
- [full] **Dead fallbacks**: null or truthiness checks on values that are never falsy (non-nullable returns, objects and arrays in JavaScript, sentinel objects) → the fallback branch is unreachable and the intended case never runs. Fix: check the producer's contract; return `null` for "none".
