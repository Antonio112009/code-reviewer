---
name: Blocking and sync-over-async
description: Blocking on async code and blocking inside async code — .Result/.Wait()/GetResult deadlocks and thread-pool starvation, Thread.Sleep and sync I/O in request paths, Kestrel's disallowed synchronous I/O, Task.Run wrappers and ConfigureAwait with synchronization contexts.
priority: 64
tags: [CWE-833, CWE-400]
activation:
  content:
    - '\.Result\b|\.Wait\(\)|\.GetAwaiter\(\)\.GetResult\(\)|\bTask\.(?:WaitAll|WaitAny)\('
    - '\bThread\.Sleep\(|\bConfigureAwait\(|\bAllowSynchronousIO\b|\bTask\.Run\('
    - '\.(?:ReadToEnd|ReadAllText|ReadAllBytes|ReadAllLines|WriteAllText|WriteAllBytes)\(|\bRequest\.Form\b'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices
  - https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-scenarios
  - https://devblogs.microsoft.com/dotnet/configureawait-faq/
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/options
---
- **Sync over async**: `.Result`, `.Wait()`, `.GetAwaiter().GetResult()`, `Task.WaitAll` on incomplete tasks → deadlock under a SynchronizationContext (WinForms/WPF/MAUI, Blazor, classic ASP.NET) and thread-pool starvation in ASP.NET Core under load. Fix: `await` end to end.
- **Blocking inside async code**: `Thread.Sleep`, sync file/stream/DB calls (`ReadAllText`, `Stream.Read`, `ExecuteReader`) in async methods or request handlers → pool threads blocked. Fix: `Task.Delay`, async APIs.
- **Kestrel sync I/O**: synchronous reads of `Request.Body`/`Request.Form`, sync writes to `Response.Body` (incl. sync serializers or `StreamWriter.Dispose`) → `InvalidOperationException` ("Synchronous operations are disallowed"); `AllowSynchronousIO = true` trades that for starvation. Fix: `ReadFormAsync`, async serializers.
- **Task.Run wrappers**: `await Task.Run(() => SyncIo())` in ASP.NET Core or `Task.Run(…).Result` "to avoid deadlocks" still block/hop threads without gaining throughput. Fix: real async APIs; `Task.Run` only for CPU work off a UI thread.
- **Blocking in construction/disposal**: `.Result` in constructors, DI factories, `Dispose()` or property getters → startup deadlocks. Fix: async factories, `IAsyncDisposable`, `IHostedService.StartAsync`.
- **ConfigureAwait**: library code without `ConfigureAwait(false)` deadlocks callers that block under a context; UI code touching controls after `ConfigureAwait(false)` runs off the UI thread → cross-thread exceptions.
