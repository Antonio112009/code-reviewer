---
name: Disposal and resource lifetime
description: IDisposable/IAsyncDisposable defects — undisposed handles and pooled connections, sync using on async-flush types, disposed objects returned to callers, over-long `using var` scopes, disposing objects you don't own, event/registration leaks and needless finalizers.
priority: 56
tags: [CWE-404, CWE-772]
activation:
  content:
    - '\busing\s*\(|\busing\s+var\b|\bawait\s+using\b|\bI(?:Async)?Disposable\b|\bDispose(?:Async)?\('
    - '\bnew\s+(?:FileStream|StreamReader|StreamWriter|BinaryReader|BinaryWriter|CancellationTokenSource|Process|HttpResponseMessage|X509Certificate2)\b'
    - '\bFile\.(?:Open|OpenRead|OpenWrite|Create)\(|\.OnChange\(|\.Register\(|~[A-Z]\w*\(\)'
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/using-objects
  - https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-disposeasync
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines
---
- **Undisposed resources**: `FileStream`, readers/writers, `HttpResponseMessage`, `DbConnection`/`DbDataReader`, `Process`, `CancellationTokenSource` with `CancelAfter` created without `using` → file locks, exhausted connection pools, live timers until GC. Fix: `using`/`await using`.
- **Sync dispose of async-flush types**: `using` instead of `await using` on `StreamWriter`/`Utf8JsonWriter` over `Response.Body` or network streams → synchronous flush blocks threads; Kestrel rejects sync I/O with `InvalidOperationException`. Fix: `await using` or `FlushAsync` first.
- **Returning disposed objects**: returning a stream, reader, lazy `IEnumerable` or an un-awaited `Task` created inside `using` → the caller gets an already-disposed object. Fix: materialize/await inside the scope or transfer ownership.
- **`using var` scope**: lives until the end of the enclosing block → connections, file locks or semaphores held across later slow work. Fix: explicit `using (…) { }` blocks.
- **Disposing what you don't own**: calling `Dispose` on DI-injected services, shared/static instances or caller-provided streams → `ObjectDisposedException` for other consumers. Fix: dispose only what you create.
- **Leaked subscriptions**: `+=` on long-lived/static events, `IOptionsMonitor.OnChange(...)` or `CancellationToken.Register(...)` results never disposed → subscribers never collected, callbacks on dead objects. Fix: unsubscribe/dispose the returned `IDisposable`.
- **Needless finalizers**: `~T()` on types without unmanaged handles → objects survive an extra GC; a throwing finalizer crashes the process. Fix: `SafeHandle`, no finalizer.
