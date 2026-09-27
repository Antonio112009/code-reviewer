---
name: Strings and culture
description: Culture-sensitive string APIs that break parsing, comparisons and security checks — default linguistic comparisons (ICU since .NET 5), ToLower/ToUpper on identifiers, culture-dependent Parse/ToString of machine data and sorting with the default comparer.
priority: 56
tags: [CWE-178, CWE-436]
activation:
  content:
    - '\.(?:ToLower|ToUpper)\(\)'
    - '\.(?:StartsWith|EndsWith|IndexOf|LastIndexOf)\('
    - '\b(?:[Ss]tring\.Compare|CompareTo)\('
    - '\b(?:double|decimal|float|DateTime|DateTimeOffset|DateOnly)\.(?:Try)?Parse(?:Exact)?\(|\bConvert\.To(?:Double|Decimal|Single|DateTime)\('
    - '\bCultureInfo\b|\bStringComparison\.|\bStringComparer\.'
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/globalization/5.0/icu-globalization-api
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu
---
- **Linguistic by default**: `string.Compare`, `CompareTo`, `StartsWith(string)`, `EndsWith(string)`, `IndexOf(string)` use the current culture; with ICU (.NET 5+) `"a\r\nb".IndexOf("\n")` is -1 and `"\0"` matches everywhere → broken protocol/path/key parsing. Fix: `StringComparison.Ordinal(IgnoreCase)` or `char` overloads.
- **Case mapping of identifiers**: `ToLower()`/`ToUpper()` with the current culture (Turkish dotless i) on keys, headers, roles, file extensions → lookups and checks fail per server locale. Fix: `ToUpperInvariant()` or `OrdinalIgnoreCase` comparisons.
- **Security comparisons**: `CurrentCultureIgnoreCase`/`InvariantCultureIgnoreCase` for usernames, paths, URLs, allowlists → ignorable characters and linguistic equivalences make different strings equal. Fix: ordinal comparisons.
- **Machine data**: `double.Parse`, `decimal.Parse`, `DateTime.Parse`, `Convert.ToDouble` or `ToString()`/interpolation of numbers and dates for files, URLs, hand-built JSON/SQL/CSV → `1,5` vs `1.5`, day/month swaps by server culture. Fix: `CultureInfo.InvariantCulture`, round-trip formats (`"O"`, `"R"`).
- **Sorting vs lookup**: `OrderBy(s => s)`, `List<string>.Sort()` use the culture-aware default comparer while `Dictionary<string,…>`/`HashSet<string>` are ordinal and case-sensitive → inconsistent ordering and missed lookups. Fix: pass `StringComparer.Ordinal(IgnoreCase)` explicitly.
