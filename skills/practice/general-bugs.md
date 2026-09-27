---
name: General defects
description: Language-agnostic logic defects — boundaries, absent and falsy values, changed contracts with stale callers, wrong conditions, copy-paste slips, aliasing, effect ordering, half-wired changes, runaway loops and cleanup.
category: practice
priority: 90
alwaysOn: true
tier: essential
tags:
  - CWE-193
  - CWE-476
  - CWE-480
  - CWE-835
  - CWE-404
---
- **Boundaries**: `<` vs `<=`, inclusive vs exclusive ends, empty input, first/last item or page, values exactly at a limit → skipped, duplicated or out-of-range items. Fix: trace empty, one, limit, last.
- **Absent or falsy values**: lookups that can miss (`find`, `get`, index, match, parse) used unchecked; `||`/`or`/truthiness treating `0`, `""`, `false` as missing → crashes, valid zeros replaced. Fix: `??`, `is None`.
- **Changed contract**: signature, return shape, units, nullability or errors changed but callers, overrides, serializers or mocks keep old assumptions → silent misbehaviour. Fix: update every call site.
- **Wrong condition**: negation lost in a refactor, `&&`/`||` swapped, broken De Morgan, inverted guard → wrong branch taken. Fix: re-derive the truth table.
- **Copy-paste & swaps**: duplicated block still using the original variable or field (`a.x` vs `b.x`); same-typed arguments swapped (`src, dst`) → silently wrong values. Fix: diff the twins.
- **Aliasing**: mutating an argument, shared default, cached object or a collection being iterated; shallow copies sharing nested data → changes leak to callers. Fix: copy first.
- **Effect order**: irreversible effect (email, charge, publish) before validation, authorization or the commit it relies on → inconsistent state if a later step fails. Fix: validate, commit, then notify.
- **Half-wired change**: new enum value missing from a switch, lookup table, serializer or permission map; new write path skipping a cache, counter or index update → wrong branch, stale reads. Fix: update every consumer.
- **Numeric traps**: integer division, counter or size overflow, float equality, numbers or versions compared as strings (`"10" < "9"`) → wrong results. Fix: wider types, parse first.
- **Runaway loops**: pagination or polling that never advances the cursor or stops on an empty page, uncapped retries, recursion over cyclic data → hangs, request storms. Fix: advance and cap.
- **Cleanup paths**: file, socket, lock, transaction or listener not released on early return, exception or cancellation → leaks, exhausted pools, deadlocks. Fix: `finally`, `defer`, `with`, `using`.
