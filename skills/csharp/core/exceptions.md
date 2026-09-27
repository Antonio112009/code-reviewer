---
name: Exceptions
description: .NET exception-handling defects — `throw ex` losing stack traces, catch-alls that swallow cancellation and timeouts, permanent TypeInitializationException from static initialisers, exceptions masked by finally/Dispose, exceptions as control flow and self-recursive properties.
priority: 55
tags: [CWE-755, A10:2025]
activation:
  content:
    - '\bcatch\b'
    - '\bthrow\s+\w+\s*;'
    - '\bstatic\s+[A-Z]\w*\s*\(\s*\)'
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions
  - https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2200
  - https://learn.microsoft.com/en-us/dotnet/api/system.typeinitializationexception
---
- **`throw ex;`**: rethrowing the caught variable resets the stack trace (CA2200) → root cause lost. Fix: `throw;`, `ExceptionDispatchInfo.Capture(ex).Throw()`, or wrap with `innerException`.
- **Catch-all swallows cancellation**: `catch (Exception)` around awaited work also catches `OperationCanceledException`/`TaskCanceledException` (incl. `HttpClient` timeouts) → cancellation logged as failure, retried, or shutdown delayed. Fix: `catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }` first.
- **Static initialisers**: exceptions from static constructors or static field initialisers (config, file, network) become `TypeInitializationException` on every later use of the type for the whole process lifetime — never retried. Fix: no I/O in static init; explicit lazy init with retry.
- **Masked exceptions**: code in `finally` or `Dispose` that throws (flushing a broken stream, rollback on a dead connection) replaces the original exception. Fix: guard cleanup, never throw from `Dispose`.
- **Control-flow exceptions**: `try { int.Parse(x) } catch`, `catch (KeyNotFoundException)`, exceptions for "not found" in hot paths → high CPU cost under load. Fix: `TryParse`, `TryGetValue`, result types.
- **Self-recursive members**: a property or method that calls itself (`public string Name { get => Name; }`, overloads forwarding to themselves) → `StackOverflowException`, which can't be caught and kills the process. Fix: use the backing field.
