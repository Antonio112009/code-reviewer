---
name: Collection indices and iteration
description: Slices that keep their parent's indices, enumerated offsets used as indices, mutation while iterating, shared references from Array(repeating:), unordered Set/Dictionary iteration, lazy re-evaluation and quadratic collection operations.
activation:
  content:
    - '\b(?:ArraySlice|Substring)\b|\.(?:enumerated|dropFirst|dropLast|prefix|suffix|removeFirst|remove)\(|\.indices\b'
    - '\[[^\]\n]{0,60}\.\.[.<][^\]\n]{0,60}\]'
    - '\bArray\(repeating:|\.hashValue\b|\blazy\.(?:map|filter|compactMap)\b'
  examples:
    - 'let slice: ArraySlice<Int> = numbers.dropFirst(2)'
    - 'let chunk = data[4..<8]'
    - 'var grid = Array(repeating: Cell(), count: 100)'
sources:
  - https://developer.apple.com/documentation/swift/arrayslice
  - https://developer.apple.com/documentation/swift/hasher
  - https://developer.apple.com/documentation/swift/array/removefirst()
---
- **Slice indices**: `ArraySlice`, `Substring` and `Data` slices (`data[4..<8]`, `dropFirst()`, `prefix`) keep the parent's indices → `slice[0]` traps or reads the wrong element. Fix: `slice.first`, `slice[slice.startIndex]`, or copy with `Array(slice)`/`Data(slice)`.
- **Offsets are not indices**: the `offset` from `enumerated()` used to subscript a slice, `Substring` or non-Array collection → wrong element or trap. Fix: `zip(c.indices, c)`.
- **Mutating while iterating**: `remove(at:)` inside `for i in array.indices` or a loop over a saved `count` → skipped elements, index out of range. Fix: `removeAll(where:)` or iterate in reverse.
- **One shared instance**: `Array(repeating: Model(), count: n)` with a class stores n references to one object → editing one edits all. Fix: `(0..<n).map { _ in Model() }`.
- **Unordered iteration**: `Set`/`Dictionary` order changes between launches (per-process hash seed) → flaky tests, unstable UI order, nondeterministic payloads or signatures; persisted `hashValue`s break. Fix: sort explicitly.
- **Lazy re-evaluation**: a stored `lazy.map`/`lazy.filter` re-runs its closure on every access → repeated side effects and cost. Fix: materialize with `Array(...)`.
- **Quadratic loops**: `removeFirst()` (O(n)) as a queue pop, `contains`/`firstIndex(of:)` on large arrays inside loops → O(n²) stalls on big inputs. Fix: an index cursor or `Deque`, `Set`/`Dictionary` lookups.
