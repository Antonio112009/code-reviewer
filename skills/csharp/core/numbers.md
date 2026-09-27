---
name: Numeric correctness
description: Arithmetic defects in C# — unchecked integer overflow, float→int casts that changed in .NET 9, banker's rounding, binary floating point for money, integer division and enum parsing that accepts undefined values.
priority: 56
tags: [CWE-190, CWE-681, CWE-682]
activation:
  content:
    - '\b(?:checked|unchecked)\b|\bMath\.(?:Round|Floor|Ceiling|Truncate)\(|\bMidpointRounding\b'
    - '\bConvert\.ToInt(?:16|32|64)\(|\((?:int|long|short|byte|uint|ulong)\)\s*[\w(]'
    - '\bdecimal\b|\b(?:double|float)\s+\w*(?:[Pp]rice|[Aa]mount|[Tt]otal|[Bb]alance|[Cc]ost|[Rr]ate)\b'
    - '\bEnum\.(?:Parse|TryParse|IsDefined)\b'
sources:
  - https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/checked-and-unchecked
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer
  - https://learn.microsoft.com/en-us/dotnet/api/system.math.round
  - https://learn.microsoft.com/en-us/dotnet/api/system.enum.tryparse
---
- **Silent overflow**: integer arithmetic is `unchecked` unless `<CheckForOverflowUnderflow>` is set → sums, `a * b`, `(int)someLong` wrap to wrong or negative values (sizes, cents, offsets). Fix: `checked`, wider types, range validation.
- **float→int casts**: `(int)` of NaN, ∞ or out-of-range doubles returned `int.MinValue` on x86/x64 before .NET 9 and saturates since .NET 9 (NaN → 0) → results differ by version/CPU; `x / 0.0` yields ∞/NaN silently. Fix: validate the range before converting.
- **Rounding**: `Math.Round(2.5)` is 2 (`MidpointRounding.ToEven` default), `Convert.ToInt32(2.5)` is 2, casts truncate → invoices and percentages off by one unit. Fix: explicit `MidpointRounding.AwayFromZero` (or the rule the business needs).
- **Money in double**: `double`/`float` for currency or exact quantities → `0.1 + 0.2 != 0.3`, drifting totals, failing `==`. Fix: `decimal`; tolerances only for measurements.
- **Integer division**: `a / b` on ints before converting (`(double)(done / total)`, `done / total * 100`) truncates → 0 %. Fix: cast an operand first.
- **Enum parsing**: `Enum.Parse`/`TryParse` accept numeric strings of undefined values (`"42"`), `(Role)intFromInput` never fails → invalid states or flags. Fix: `Enum.IsDefined` (non-flags) or an explicit allowlist.
