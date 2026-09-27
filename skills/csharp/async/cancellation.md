---
name: Cancellation tokens
description: CancellationToken defects — tokens not flowed, leaked CancellationTokenSource timers and linked registrations, cancellation treated as failure, partial writes after mid-operation cancel, WhenAny/Delay timeouts that don't stop work, and blocking Cancel callbacks.
priority: 60
activation:
  content:
    - '\bCancellationToken(?:Source)?\b|\bCreateLinkedTokenSource\b|\bCancelAfter\('
    - '\bThrowIfCancellationRequested\(|\bIsCancellationRequested\b|\bRequestAborted\b'
    - '\b(?:Operation|Task)CanceledException\b|\bTask\.WhenAny\(|\.Register\('
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads
  - https://github.com/davidfowl/AspNetCoreDiagnosticScenarios/blob/master/AsyncGuidance.md
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.waitasync
---
- **Token not flowed**: accepting a `CancellationToken` but calling EF (`ToListAsync()`), `HttpClient`, `Stream.ReadAsync` or `Task.Delay` without it → work continues after client disconnect/shutdown. In ASP.NET Core use the action's token or `HttpContext.RequestAborted`.
- **Leaked sources**: `new CancellationTokenSource(timeout)`/`CancelAfter` or `CreateLinkedTokenSource(longLivedToken, …)` never disposed → timers and parent registrations accumulate per request (memory growth). Fix: `using var cts = …`.
- **Leaked registrations**: `token.Register(...)` on long-lived tokens (`stoppingToken`, `ApplicationStopping`) without disposing the `CancellationTokenRegistration` → callbacks pile up. Fix: dispose the registration.
- **Cancellation as failure**: catching `OperationCanceledException` as an error (logged, retried, returned as 500), or treating an `HttpClient` timeout as user cancel. Fix: `when (ct.IsCancellationRequested)` filters to tell them apart.
- **Mid-operation cancel**: passing the request token to later steps of a multi-write operation (second `SaveChangesAsync`, message publish) → partial state when cancelled between steps. Fix: stop honouring cancellation once committing starts (`CancellationToken.None`) or use a transaction.
- **Timeouts that don't stop work**: `await Task.WhenAny(work, Task.Delay(t))` leaves `work` and the delay timer running. Fix: `work.WaitAsync(t, ct)` (.NET 6+) plus cancelling the underlying operation.
- **Blocking cancel**: `cts.Cancel()` runs registered callbacks synchronously on the caller (deadlocks under locks). Fix: `CancelAsync()` (.NET 8+) or no locks while cancelling.
