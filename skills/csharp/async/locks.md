---
name: Locks and synchronization primitives
description: Locking defects — SemaphoreSlim permits leaked or over-released, thread-affine locks held across await, bad lock targets, .NET 9 System.Threading.Lock downgraded to Monitor, broken double-checked locking, unbounded per-key locks and in-process locks in multi-instance apps.
priority: 62
tags: [CWE-667, CWE-833]
activation:
  content:
    - '\block\s*\(|\bSemaphoreSlim\b|\bMonitor\.(?:Enter|TryEnter|Exit|Wait|Pulse)'
    - '\bMutex\b|\bReaderWriterLock(?:Slim)?\b|\bSpinLock\b|\bThreading\.Lock\b|\bLock\s+_?\w+\s*=\s*new\b'
    - '\bvolatile\b|\bVolatile\.|\bLazyInitializer\b'
  examples:
    - 'lock (_gate) { count++; }'
    - 'private readonly SemaphoreSlim _sem = new(1, 1);'
    - 'Monitor.Enter(_gate);'
    - 'private readonly Mutex _mutex = new();'
    - 'private readonly ReaderWriterLockSlim _rw = new();'
    - 'private readonly SpinLock _spin = new();'
    - 'private System.Threading.Lock _gate = new();'
    - 'Lock _door = new();'
    - 'private volatile bool _initialized;'
    - 'Volatile.Write(ref _flag, true);'
    - 'var value = LazyInitializer.EnsureInitialized(ref _cache);'
sources:
  - https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.semaphoreslim
  - https://learn.microsoft.com/en-us/dotnet/api/system.threading.readerwriterlockslim
  - https://learn.microsoft.com/en-us/dotnet/standard/threading/overview-of-synchronization-primitives
---
- **Semaphore permits**: `await sem.WaitAsync()` without `try { … } finally { sem.Release(); }` → one exception leaks a permit, later callers wait forever; releasing after `WaitAsync(timeout)` returned `false` → `SemaphoreFullException` or extra concurrency. Fix: check the result, release in `finally`.
- **Thread-affine locks across `await`**: `Monitor.Enter`, `Mutex`, `ReaderWriterLockSlim`, `SpinLock` held over an `await` resume on another thread → `SynchronizationLockException` on release or a lock never freed. Fix: `SemaphoreSlim(1, 1)`.
- **Bad lock targets**: `lock(this)`, `lock(typeof(T))`, `lock("name")` (interned strings) or a freshly boxed value → outside code can deadlock you, or nothing is excluded. Fix: a private readonly object or `System.Threading.Lock` (.NET 9+).
- **Lock downgraded**: a `System.Threading.Lock` used via `object`, `Monitor.*` or a generic parameter falls back to Monitor → `lock(field)` and `Monitor.Enter((object)field)` paths don't exclude each other. Fix: keep it typed as `Lock`.
- **Double-checked locking**: `if (x == null) lock(g) { if (x == null) x = new … }` without `volatile`/`Volatile.Read`, or publishing before init completes → half-built objects seen. Fix: `Lazy<T>`/`LazyInitializer`.
- **Per-key and per-process**: `ConcurrentDictionary<string, SemaphoreSlim>` never pruned grows forever; `lock`/`SemaphoreSlim` guarding jobs, cache fills or migrations doesn't stop other instances. Fix: ref-counted keyed locks; distributed/DB locks when scaled out.
