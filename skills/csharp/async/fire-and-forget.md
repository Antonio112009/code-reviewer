---
name: Fire-and-forget and unobserved tasks
description: Tasks started but not awaited — lost exceptions, request-scoped objects (HttpContext, DbContext, scoped services) used after the request, `return Task` inside using/try without await, and work killed at shutdown.
priority: 64
tags: [CWE-362, CWE-664]
activation:
  content:
    - '\b_\s*=\s*[\w.]+Async\('
    - '\bTask\.Run\(|\bTask\.Factory\.StartNew\(|\bThreadPool\.QueueUserWorkItem\('
    - '\breturn\s+(?!await\b)[\w.]+Async\('
  examples:
    - '_ = ProcessOrderAsync(order);'
    - 'Task.Run(() => CleanupAsync());'
    - 'Task.Factory.StartNew(() => Process());'
    - 'ThreadPool.QueueUserWorkItem(_ => DoWork());'
    - 'return SaveChangesAsync();'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices
  - https://github.com/davidfowl/AspNetCoreDiagnosticScenarios/blob/master/AsyncGuidance.md
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services
---
- **Unawaited task**: an async call without `await` (or `_ = DoAsync()`) → exceptions silently lost, work races the caller and outlives the request; CS4014 fires only inside async methods and `_ =` hides it. Fix: await, or enqueue to a `BackgroundService`.
- **Request state in background work**: `Task.Run`/fire-and-forget closures capturing `HttpContext`, `DbContext`, scoped services or the request `IServiceProvider` → `ObjectDisposedException`, wrong user, DbContext threading errors after the response. Fix: copy the data needed; create a scope with `IServiceScopeFactory` inside the work.
- **Return without await**: `return FooAsync();` inside `using`, `try/catch/finally` or scoped state → resources disposed and `finally` run before the operation completes; its exception bypasses the `catch`. Fix: `return await FooAsync();`.
- **Collected but never observed**: tasks added to lists without `await Task.WhenAll`, or observed only via `ContinueWith` that ignores faults → failures reported nowhere. Fix: await every task.
- **Killed at shutdown**: detached work isn't tracked by the host → cut off mid-write on deploy/scale-in. Fix: `BackgroundService` honoring `stoppingToken`, or a durable queue.
