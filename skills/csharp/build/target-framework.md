---
name: Target frameworks and build diagnostics
description: TargetFramework(s) changes — end-of-life .NET versions, exact-version `#if NETx_0` symbols that drop code when a target is added, and newly suppressed nullable/trimming warnings.
priority: 58
activation:
  content:
    - '<(?:TargetFrameworks?|Nullable|NoWarn|WarningsNotAsErrors|TreatWarningsAsErrors)\b'
  examples:
    - '<TargetFramework>net8.0</TargetFramework>'
    - '<NoWarn>CS8602;CS8618</NoWarn>'
sources:
  - https://devblogs.microsoft.com/dotnet/dotnet-8-9-end-of-support/
  - https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core
  - https://learn.microsoft.com/en-us/dotnet/standard/frameworks
---
- **End-of-life TFM**: `net6.0`/`net7.0` are unsupported; `net8.0` (LTS) and `net9.0` (STS) lose security fixes on 10 Nov 2026 → unpatched runtime and ASP.NET Core CVEs in production. Fix: target `net10.0` (LTS until Nov 2028).
- **Exact TFM symbols**: adding a target to `<TargetFrameworks>` (or bumping `<TargetFramework>`) while code uses `#if NET8_0` — defined only for net8.0 — silently drops that branch on the new target. Fix: `NET8_0_OR_GREATER`-style symbols.
- **Suppressed diagnostics**: new `<NoWarn>`/`<WarningsNotAsErrors>` entries for `CS86xx` (nullable) or `IL2xxx`/`IL3xxx` (trim/AOT), or switching an enabled project to `<Nullable>disable` → real null dereferences and trimming breaks ship without warnings. Fix: fix the code; suppress locally with a reason.
