---
name: Dependency injection lifetimes
description: Microsoft.Extensions.DependencyInjection defects — captive scoped dependencies in singletons, resolving from the root provider or a second container, disposable transients leaking from the root, instances the container won't dispose, silent registration overrides and async factories.
priority: 66
tags: [CWE-362, CWE-401]
activation:
  content:
    - '\bAdd(?:Singleton|Scoped|Transient|Keyed(?:Singleton|Scoped|Transient))\b|\bTryAdd\w*\('
    - '\bIServiceProvider\b|\bIServiceScopeFactory\b|\bCreate(?:Async)?Scope\(|\bBuildServiceProvider\('
    - '\bGet(?:Required)?Service\b|\bApplicationServices\b|\bapp\.Services\b'
  examples:
    - 'services.AddSingleton<IEmailSender, SmtpEmailSender>();'
    - 'using var scope = _scopeFactory.CreateScope();'
    - 'var db = app.Services.GetRequiredService<AppDbContext>();'
sources:
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/service-lifetimes
  - https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/9/hostbuilder-validation
---
- **Captive dependency**: singletons (incl. middleware classes, `IExceptionHandler`) taking scoped dependencies (`DbContext`, `IOptionsSnapshot<T>`, current-user services) → one instance for all requests: stale data, threading errors, cross-user leaks; scope validation runs only in Development. Fix: `IServiceScopeFactory.CreateScope()` per unit of work.
- **Root or second container**: resolving scoped services from `app.Services`/an injected `IServiceProvider` in singletons makes them de-facto singletons; `BuildServiceProvider()` inside registration builds a second container with duplicate singletons (ASP0000). Fix: `CreateScope`, factory overloads receiving `IServiceProvider`.
- **Disposable transients from root**: `IDisposable` transients resolved outside a scope are tracked until the container is disposed → memory leak. Fix: resolve inside a scope or use a factory and dispose manually.
- **Container won't dispose**: `AddSingleton(new Foo())`/pre-built instances are never disposed by DI; disposing injected services yourself breaks other consumers. Fix: let the container create them; don't dispose dependencies.
- **Registration overrides**: repeated `Add*` → last wins for single injection, but `IEnumerable<T>` gets all (handlers run twice); `TryAdd*` silently skipped; `AddSingleton<IA, C>()` + `AddSingleton<IB, C>()` → two "singleton" instances. Fix: forward with `sp => sp.GetRequiredService<C>()`.
- **Async factories**: `AddSingleton(sp => InitAsync().Result)` or blocking constructors → deadlocks/starvation on first resolution. Fix: sync factories; warm up in `IHostedService.StartAsync`.
