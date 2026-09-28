---
name: Options and configuration binding
description: IOptions/IConfiguration defects — options interface vs lifetime, silently unbound or misnamed settings, unvalidated nested options, array merging across appsettings files and env vars, `:` in environment variable names, and .NET 10 null-binding changes.
priority: 60
activation:
  content:
    - '\bIOptions(?:Monitor|Snapshot)?<|\b(?:AddOptions|BindConfiguration|ValidateOnStart|ValidateDataAnnotations|AddOptionsWithValidateOnStart)\b'
    - '\bGet(?:Required)?Section\(|\bGetValue<|\bGetConnectionString\(|\.Bind\(|\bConfiguration\['
    - '^\s*"[A-Z][\w.:]*"\s*:'
  examples:
    - 'public MyService(IOptionsSnapshot<MySettings> options)'
    - 'var section = configuration.GetRequiredSection("Smtp");'
    - '"ConnectionStrings": "Server=.;Database=App;"'
sources:
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/options
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/configuration-providers
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/extensions/10.0/configuration-null-values-preserved
  - https://github.com/dotnet/runtime/issues/118204
---
- **Wrong options interface**: `IOptions<T>` is computed once → reloads never seen; `IOptionsSnapshot<T>` is scoped → invalid in singletons; `IOptionsMonitor<T>.OnChange` returns an `IDisposable` to keep. Mutating `.Value` changes it for everyone. Fix: choose by lifetime; treat options as read-only.
- **Silently unbound settings**: typos in section/property names, wrong nesting or unset env vars leave defaults (the binder ignores unknown keys; `GetSection` never returns null) → zero timeouts, empty URLs, disabled features. Fix: `ValidateDataAnnotations().ValidateOnStart()`, `GetRequiredSection`, `BinderOptions.ErrorOnUnknownConfiguration`.
- **Nested validation**: DataAnnotations validation of options doesn't recurse into nested objects/collections. Fix: `[ValidateObjectMembers]`/`[ValidateEnumeratedItems]` (.NET 8+) or custom validators.
- **Array merging**: arrays from `appsettings.json`, `appsettings.{Env}.json` and env vars merge by index — `["A","B"]` overridden by `["C"]` yields `["C","B"]` → stale hosts/origins/allowlists stay active. Fix: equal lengths or a single delimited value.
- **Env var names**: hierarchical keys with `:` don't work in all shells/platforms → the override is silently ignored. Fix: `Section__Key`.
- **.NET 10 nulls**: explicit `null` in JSON now binds as null (previously skipped or turned into `""`) → defaults set in constructors get overwritten after upgrading. Fix: remove null entries or handle null.
