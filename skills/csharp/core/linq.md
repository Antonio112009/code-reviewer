---
name: LINQ and deferred execution
description: LINQ-to-objects defects — repeated enumeration of lazy sequences, deferred side effects and captured variables, late argument validation in iterators, First/Single/ToDictionary exceptions and accidental O(n²) lookups.
priority: 54
activation:
  content:
    - '\.(?:Select|SelectMany|Where|GroupBy|OrderBy|OrderByDescending|ThenBy|Distinct|DistinctBy|ToDictionary|ToLookup|First|Single|SingleOrDefault|Last|ElementAt|Aggregate|Zip)\('
    - '\byield\s+(?:return|break)\b'
    - '\bIEnumerable<'
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/linq/deferred-execution-lazy-evaluation
  - https://learn.microsoft.com/en-us/dotnet/csharp/iterators
  - https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.todictionary
---
- **Multiple enumeration**: an `IEnumerable<T>` from LINQ, `yield` or a query re-runs on every enumeration (`Count()` then `foreach`, `Any()` then `First()`) → repeated I/O, side effects twice, results changing between passes. Fix: materialize once with `ToList()`/`ToArray()`.
- **Deferred side effects**: work inside `Select`/`Where` lambdas runs only when enumerated — never, if nobody enumerates — and closures see variable values from enumeration time. Fix: materialize immediately; keep lambdas pure.
- **Late argument checks**: validation inside a `yield return` method runs on the first `MoveNext`, not at the call → exceptions surface far away or never. Fix: validate in a non-iterator wrapper that returns the iterator.
- **Throwing operators**: `First()`/`Single()`/`Last()` throw on empty; `Single()` also throws on duplicates; `ToDictionary` throws `ArgumentException` on duplicate keys (case variants, repeated rows) → production exceptions on unexpected data. Fix: `*OrDefault`, `ToLookup`, `DistinctBy` (.NET 6+).
- **Unordered "first"**: `FirstOrDefault(predicate)` over sets or unordered sources picks an arbitrary match → nondeterministic results. Fix: `OrderBy` first or enforce uniqueness.
- **Accidental O(n²)**: `list.Contains`, `Any(x => …)`, `Where(…).First()` or `ElementAt(i)` inside loops over large inputs → quadratic time. Fix: build a `HashSet`/`ToDictionary`/`ToLookup` once.
