---
name: Records, structs and copies
description: Value-semantics bugs — record equality over collection members, shallow `with` copies and stale computed properties, mutations lost on struct copies and defensive copies, and struct constructors skipped by default(T).
priority: 55
activation:
  content:
    - '\brecord\s+(?:class\s+|struct\s+)?[A-Z]\w*'
    - '\bwith\s*\{'
    - '\b(?:readonly\s+)?(?:record\s+)?struct\s+[A-Z]\w*'
  examples:
    - 'public record Money(decimal Amount, string Currency);'
    - 'var updated = order with { Status = OrderStatus.Shipped };'
    - 'public readonly record struct Point(double X, double Y);'
sources:
  - https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record
  - https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct
  - https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/with-expression
---
- **Record equality over collections**: synthesized `Equals` compares `List<T>`/array members by reference → records with equal contents are unequal (dedup, `Distinct`, cache keys, change detection fail). Fix: custom `Equals`/`GetHashCode` or value-equal collections.
- **`with` is shallow**: the copy shares lists and nested objects, so mutating one mutates both; properties computed in initializers (`Total { get; } = A + B`) stay stale after `with { A = … }`. Fix: deep-copy mutable members; compute in getters.
- **Mutating struct copies**: mutating methods called on a struct from a `List<T>` indexer, dictionary value, property, `foreach` variable, `readonly` field or `in` parameter act on a copy → update silently lost. Fix: `readonly struct`, reassign the whole value.
- **Mutable `record struct`**: positional properties of `record struct` are settable (unlike `record class` and `readonly record struct`) → copies drift apart unnoticed. Fix: `readonly record struct`.
- **Constructors skipped**: parameterless struct constructors and field initializers (C# 10+) don't run for `default(T)`, `new T[n]` elements or unassigned fields → invariants missing. Fix: make the all-zero state valid.
