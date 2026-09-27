---
name: Shared state and thread safety
description: Data races on shared state — non-concurrent collections written in parallel, non-atomic ConcurrentDictionary compound operations, shared Random, non-atomic ++, mutable singleton state, ThreadStatic with async, and Lazy<T> caching exceptions.
priority: 62
tags: [CWE-362, CWE-366, CWE-488]
activation:
  content:
    - '\bConcurrent(?:Dictionary|Bag|Queue|Stack)<|\b(?:GetOrAdd|AddOrUpdate)\('
    - '\bnew\s+Random\(|\bRandom\.Shared\b|\bInterlocked\.'
    - '\bParallel\.(?:For|ForEach|ForEachAsync|Invoke)\(|\bTask\.WhenAll\('
    - '\[ThreadStatic\]|\bThreadLocal<|\bAsyncLocal<|\bLazy<'
    - '\bstatic\s+(?:Dictionary|List|HashSet|Random|int|long|bool|string)\b|\bAddSingleton\b'
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/collections/thread-safe/
  - https://learn.microsoft.com/en-us/dotnet/api/system.collections.concurrent.concurrentdictionary-2.getoradd
  - https://learn.microsoft.com/en-us/dotnet/api/system.random
  - https://learn.microsoft.com/en-us/dotnet/framework/performance/lazy-initialization
---
- **Unsafe collections shared**: `Dictionary`/`List`/`HashSet` in singletons, statics or `Parallel`/`Task.WhenAll` branches written concurrently → lost items, corrupted buckets, infinite loops or `InvalidOperationException`. Fix: concurrent collections, immutable snapshots or locks.
- **ConcurrentDictionary isn't transactional**: `GetOrAdd`/`AddOrUpdate` factories may run several times concurrently (one result kept) → duplicate expensive/side-effecting work; `ContainsKey` then `TryAdd`/indexer set races; stored values aren't protected. Fix: `GetOrAdd(k, _ => new Lazy<T>(…)).Value`, atomic methods only.
- **Shared Random**: one `new Random()` used from several threads corrupts its state (starts returning 0). Fix: `Random.Shared` (.NET 6+) or per-thread instances.
- **Non-atomic updates**: `count++`, `total += x`, flag toggles on shared fields → lost updates. Fix: `Interlocked.Increment/Add/CompareExchange` or a lock.
- **Mutable singleton state**: fields holding per-request data (current user, tenant, request DTO) in singletons or statics → data leaks between concurrent users. Fix: pass state explicitly or keep it scoped.
- **Thread-bound state with async**: `[ThreadStatic]`/`ThreadLocal<T>` values vanish or leak across requests because continuations resume on other pool threads. Fix: `AsyncLocal<T>` (flows to callees only; callee changes don't flow back).
- **Lazy caches exceptions**: `Lazy<T>` with a factory in `ExecutionAndPublication` mode caches the first exception forever (e.g. a transient network error at startup). Fix: `PublicationOnly` or a retrying async lazy.
