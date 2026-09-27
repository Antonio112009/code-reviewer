---
name: Regular expressions
description: .NET Regex defects — unbounded matching (ReDoS) with the default infinite timeout, `$` accepting a trailing newline in validation, per-call construction and the 15-pattern static cache, and Unicode-wide \d/\w in input validation.
priority: 60
tags: [CWE-1333, CWE-625, CWE-185]
activation:
  content:
    - '\bRegex\b|\[GeneratedRegex\b|\[RegularExpression\('
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-regex
  - https://learn.microsoft.com/en-us/dotnet/standard/base-types/anchors-in-regular-expressions
  - https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-classes-in-regular-expressions
---
- **No timeout (ReDoS)**: `new Regex(p)` and static `Regex.IsMatch/Match/Replace` without `matchTimeout` run unbounded; nested quantifiers (`(a+)+`, `(\w+\s?)*`) or user-built patterns (`new Regex(userInput)`) pin a CPU per request. Fix: timeout, `RegexOptions.NonBacktracking` (.NET 7+), `Regex.Escape` for user text.
- **`$` accepts a trailing newline**: `^[a-z0-9]+$` matches `"admin\n"` because `$` also matches before a final `\n` → header/log injection, allowlist bypass. Fix: `\z` (`[RegularExpression]` already requires a full match).
- **Construction per call**: `new Regex(...)` (worse with `RegexOptions.Compiled`) inside methods/loops re-parses/compiles every time; static methods cache only 15 patterns (`Regex.CacheSize`). Fix: `static readonly` instances or `[GeneratedRegex]` (.NET 7+).
- **Unicode classes**: `\d` matches any Unicode decimal digit (Arabic-Indic, fullwidth…) and `\w` any letter → "numeric" input passes validation then fails `int.Parse` or bypasses ASCII-only assumptions. Fix: `[0-9]`, `[A-Za-z0-9_]`, or `RegexOptions.ECMAScript`.
