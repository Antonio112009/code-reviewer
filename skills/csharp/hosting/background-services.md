---
name: Hosted and background services
description: IHostedService/BackgroundService defects — one exception stopping the host (or silently killing the loop), captive scoped dependencies, startup blocked by synchronous ExecuteAsync code before .NET 10, ignored stoppingToken, duplicate jobs per replica and busy loops.
priority: 64
tags: [CWE-248, CWE-400]
activation:
  content:
    - '\bBackgroundService\b|\bIHostedService\b|\bIHostedLifecycleService\b|\bAddHostedService\b'
    - '\bExecuteAsync\s*\(\s*CancellationToken\b|\bstoppingToken\b|\bIHostApplicationLifetime\b'
    - '\bBackgroundServiceExceptionBehavior\b|\bShutdownTimeout\b'
  examples:
    - 'public class EmailWorker : BackgroundService'
    - 'protected override async Task ExecuteAsync(CancellationToken stoppingToken)'
    - 'services.Configure<HostOptions>(o => o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore);'
sources:
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/6.0/hosting-exception-handling
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/extensions/10.0/backgroundservice-executeasync-task
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/generic-host
---
- **One exception ends it**: an unhandled exception in `ExecuteAsync` stops the whole host (`BackgroundServiceExceptionBehavior.StopHost`, default since .NET 6) → a transient DB error takes the API down; with `Ignore` the loop dies silently. Fix: try/catch per iteration with logging and backoff.
- **Scoped dependencies**: injecting `DbContext` or other scoped services into the hosted service constructor (a singleton) → one context for the app's lifetime. Fix: `IServiceScopeFactory.CreateAsyncScope()` per iteration/message.
- **Blocking startup (.NET 8/9)**: code before the first `await` in `ExecuteAsync` runs during host start → long synchronous work delays other services and Kestrel. .NET 10 runs all of `ExecuteAsync` in the background; `StartAsync` overrides still block. Fix: short startup code.
- **Ignored stoppingToken**: `while (true)` loops, delays or queries without `stoppingToken` → shutdown waits for `HostOptions.ShutdownTimeout` (30 s since .NET 6), then work is cut mid-operation. Fix: flow the token, checkpoint on cancellation.
- **Runs in every replica**: timers/cron-like loops in hosted services execute once per instance when scaled out → duplicate e-mails, double billing. Fix: distributed lock, leader election or a single worker deployment.
- **Busy loops**: polling without a delay when there's no work → 100 % CPU and database hammering. Fix: `PeriodicTimer`, backoff, or a blocking queue read.
