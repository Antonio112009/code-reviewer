---
name: Runtime switches in project files
description: MSBuild/runtimeconfig switches that change behaviour at run time — InvariantGlobalization, PublishTrimmed/PublishAot with reflection, EnableUnsafeBinaryFormatterSerialization, and DOTNET_* environment variables overriding project settings on .NET 9+.
priority: 58
activation:
  content:
    - '<(?:InvariantGlobalization|PublishTrimmed|PublishAot|TrimMode|IsAotCompatible|EnableUnsafeBinaryFormatterSerialization|RuntimeHostConfigurationOption|ServerGarbageCollection|ConcurrentGarbageCollection|UseSystemResourceKeys)\b'
  examples:
    - '<InvariantGlobalization>true</InvariantGlobalization>'
    - '<PublishTrimmed>true</PublishTrimmed>'
sources:
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/globalization/6.0/culture-creation-invariant-mode
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/serialization/8.0/publishtrimmed
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/serialization/9.0/binaryformatter-removal
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/deployment/9.0/envvar-precedence
---
- **InvariantGlobalization**: `<InvariantGlobalization>true</InvariantGlobalization>` (default in AOT templates) → `new CultureInfo("de-DE")` throws `CultureNotFoundException` (.NET 6+), formatting and sorting become invariant, IANA↔Windows time-zone ids stop resolving. Fix: enable only when nothing is culture-specific.
- **Trimming / Native AOT**: `PublishTrimmed`/`PublishAot` with reflection (`JsonSerializer` without a `JsonSerializerContext`, `Activator.CreateInstance`, `Type.GetType(string)`) → members trimmed away; .NET 8+ disables reflection-based JSON when trimming → runtime `InvalidOperationException`. Fix: source generators; resolve IL2026/IL3050 warnings.
- **BinaryFormatter switch**: `EnableUnsafeBinaryFormatterSerialization=true` re-enables an RCE-prone serializer on .NET 8 and has no effect on .NET 9+, where `BinaryFormatter` always throws. Fix: migrate the payload format.
- **Environment variables win (.NET 9+)**: `DOTNET_*` variables now take precedence over `runtimeconfig.json`/project settings (e.g. `DOTNET_gcServer`, invariant globalization) → container or host environment silently overrides what the project configured. Fix: configure each setting in one place.
