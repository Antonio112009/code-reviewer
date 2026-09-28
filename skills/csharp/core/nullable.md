---
name: Nullability traps
description: Null-reference defects nullable annotations don't catch — null-forgiving operators, default values from *OrDefault on value types, Try-pattern annotations, default ImmutableArray, Nullable<T>.Value and racy event invocation.
priority: 57
tags: [CWE-476]
activation:
  content:
    - '[\w)\]]!(?:\.|\)|;|,|\[)'
    - '\b(?:null|default)!'
    - '\b(?:FirstOrDefault|SingleOrDefault|LastOrDefault|ElementAtOrDefault)(?:Async)?\('
    - '\[(?:NotNullWhen|MaybeNullWhen|NotNull|MaybeNull|AllowNull|DisallowNull|MemberNotNull|MemberNotNullWhen)\b'
    - '\bImmutableArray<|\.HasValue\b|\bGetValueOrDefault\(|#nullable\b'
  examples:
    - 'var name = user!.Name;'
    - 'string id = null!;'
    - 'var first = items.FirstOrDefault();'
    - 'public bool TryFind(string key, [MaybeNullWhen(false)] out User user)'
    - 'if (count.HasValue) total += count.GetValueOrDefault();'
sources:
  - https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references
  - https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis
  - https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutablearray-1
---
- **Null-forgiving hides nulls**: `x!`, `null!`, `default!` silence the compiler, not the runtime (`FirstOrDefault()!`, `GetService<T>()!`, deserialized results) → `NullReferenceException` far from the cause. Fix: check at the boundary, `GetRequiredService`.
- **Value-type defaults**: `FirstOrDefault`/`SingleOrDefault` on `int`, `Guid`, `DateTime`, struct sequences return `0`/`default`, not null → "not found" looks like a real item (id 0, `Guid.Empty`). Fix: `Any()` first, or project to `T?`.
- **Try-pattern contracts**: using the `out` value when `TryGetValue`/`TryParse` returned false; custom `Try*` without `[NotNullWhen(true)]`/`[MaybeNullWhen(false)]` → the compiler can't warn and nulls flow. Fix: annotate and branch on the bool.
- **default(ImmutableArray<T>)**: an unassigned field or `default` has `IsDefault == true`; `Length`, indexing and `foreach` throw. Fix: initialize with `ImmutableArray<T>.Empty`, check `IsDefaultOrEmpty`.
- **Nullable<T>**: `.Value` or `(int)x` on a null `int?`/`DateTime?` throws `InvalidOperationException`; `?? 0`/`GetValueOrDefault()` turn "missing" into a valid zero or 0001-01-01. Fix: branch on `HasValue`.
- **Event race**: `if (Changed != null) Changed(this, e);` → unsubscribe between check and call throws. Fix: `Changed?.Invoke(this, e)`.
