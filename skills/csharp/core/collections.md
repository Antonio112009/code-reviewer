---
name: Collections and keys
description: Collection defects — mutating while enumerating, Dictionary indexer vs TryGetValue/Add semantics, mutable or struct keys without proper equality, unstable sorts and inconsistent comparers, and relying on Dictionary enumeration order.
priority: 55
activation:
  content:
    - '\b(?:List|Dictionary|HashSet|SortedDictionary|SortedSet|SortedList|Queue|Stack|LinkedList)<'
    - '\.(?:Sort|RemoveAll|TryGetValue|ContainsKey|TryAdd|GetValueOrDefault)\('
    - '\bIEqualityComparer<|\bIComparer<|\bComparison<|\boverride\s+int\s+GetHashCode\('
sources:
  - https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.dictionary-2
  - https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.sort
  - https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.gethashcode
  - https://learn.microsoft.com/en-us/dotnet/api/system.object.gethashcode
---
- **Modify while enumerating**: `Add`/`Remove` on a `List`, `HashSet` or `Dictionary` inside its own `foreach` or a LINQ query over it → `InvalidOperationException` (only `Dictionary.Remove`/`Clear` are allowed during enumeration, .NET Core 3.0+). Fix: iterate a snapshot, `RemoveAll`, or collect then apply.
- **Indexer semantics**: `dict[key]` throws `KeyNotFoundException` for missing keys; `dict[key] = v` silently overwrites where `Add` would reveal a duplicate. Fix: `TryGetValue`, `TryAdd`, `GetValueOrDefault`.
- **Mutable keys**: objects whose `GetHashCode` uses mutable fields, mutated while in a `Dictionary`/`HashSet` → entries become unreachable (lookups and `Remove` miss). Fix: immutable keys, or remove, mutate, re-add.
- **Struct keys without equality**: structs lacking `IEquatable<T>`/`GetHashCode` overrides use reflection-based `ValueType.Equals` and a weak default hash → slow lookups, collisions. Fix: `record struct` or explicit implementations.
- **Unstable sort**: `List<T>.Sort`/`Array.Sort` are unstable (equal items reorder) while `OrderBy` is stable; comparers that aren't a total order (random, `a < b ? -1 : 1`) → wrong order or "IComparer.Compare() returns inconsistent results". Fix: `OrderBy().ThenBy()`, consistent comparers.
- **Enumeration order**: relying on `Dictionary`/`HashSet` order (not guaranteed, changes after removals) for output, hashing or signatures → nondeterministic results. Fix: sort explicitly or `SortedDictionary`.
