---
name: Task API misuse
description: Misused Task APIs — Task.Factory.StartNew with async lambdas, WhenAll/WhenAny exception and completion semantics, unbounded fan-out, tasks started twice by lazy LINQ, TaskCompletionSource without RunContinuationsAsynchronously, ValueTask consumed twice and ContinueWith.
priority: 62
activation:
  content:
    - '\bTask\.Factory\.StartNew\(|\bContinueWith\('
    - '\bTask\.(?:WhenAll|WhenAny|WaitAll|WaitAny)\(|\bParallel\.ForEachAsync\('
    - '\bTaskCompletionSource\b|\bValueTask\b'
    - '\.Select\(\s*(?:async\s+)?\w+\s*=>\s*[\w.]+Async\('
  examples:
    - 'Task.Factory.StartNew(async () => await ProcessAsync());'
    - 'task.ContinueWith(t => LogResult(t));'
    - 'await Task.WhenAll(saveTask, notifyTask);'
    - 'await Parallel.ForEachAsync(items, async (item, ct) => await ProcessAsync(item, ct));'
    - 'var tcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);'
    - 'public ValueTask<int> GetCachedAsync(string key)'
    - 'var tasks = items.Select(x => CallAsync(x));'
sources:
  - https://devblogs.microsoft.com/dotnet/task-run-vs-task-factory-startnew/
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.whenall
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.valuetask-1
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.parallel.foreachasync
---
- **StartNew with async lambdas**: `Task.Factory.StartNew(async () => …)` returns `Task<Task>`; awaiting it waits only until the first inner `await` (and it uses `TaskScheduler.Current`). Fix: `Task.Run` or `.Unwrap()`.
- **WhenAll exceptions**: `await Task.WhenAll(tasks)` rethrows only the first exception (others in `.Exception.InnerExceptions`); `.Wait()`/`.Result` wrap in `AggregateException`, so `catch (SpecificException)` never matches. Fix: inspect every task.
- **WhenAny semantics**: `Task.WhenAny` never throws; losers keep running with unobserved failures. Fix: await the returned task, cancel the rest.
- **Unbounded fan-out**: `Task.WhenAll(items.Select(CallAsync))` over large inputs → thousands of concurrent calls (pool exhaustion, 429s). Fix: `Parallel.ForEachAsync` (`MaxDegreeOfParallelism`, default = CPU count) or `SemaphoreSlim`.
- **Lazy task creation**: `var tasks = items.Select(DoAsync);` enumerated twice (`WhenAll(tasks)` then `foreach`) starts every operation twice. Fix: `.ToList()` first.
- **TaskCompletionSource**: without `TaskCreationOptions.RunContinuationsAsynchronously`, awaiters run inline in `SetResult`, often under the caller's lock → deadlocks; a second `SetResult` throws. Fix: that option and `TrySet*`.
- **ValueTask reuse**: awaiting a `ValueTask` twice or concurrently, storing it, or `.Result` before completion → undefined behaviour with pooled sources. Fix: await once or `.AsTask()`.
- **ContinueWith**: runs on `TaskScheduler.Current`, also after faults/cancellation, and ignores antecedent exceptions unless read. Fix: `await`.
