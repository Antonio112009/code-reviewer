---
name: Shared mutable state in coroutines
description: Races and deadlocks in concurrent coroutines — non-atomic read-modify-write on state flows and fields, non-reentrant Mutex, JVM locks and @Synchronized across suspension points, and ThreadLocal values lost when a coroutine switches threads.
priority: 64
tags: [CWE-362, CWE-667, CWE-833]
activation:
  content:
    - '\bMutex\s*\('
    - '\.withLock\s*[({]'
    - '@Synchronized\b'
    - '\bsynchronized\s*\('
    - '\bReentrant(?:ReadWrite)?Lock\b'
    - '\bThreadLocal\b'
    - '\.value\s*=\s*\w+\.value\b'
    - '\.value\s*(?:\+\+|--|\+=|-=)'
  examples:
    - 'val mutex = Mutex()'
    - 'mutex.withLock { counter++ }'
    - '@Synchronized fun increment() { count++ }'
    - 'synchronized(lock) { count++ }'
    - 'val lock = ReentrantLock()'
    - 'val requestId = ThreadLocal<String>()'
    - '_state.value = _state.value.copy(count = 1)'
    - 'counter.value++'
sources:
  - https://kotlinlang.org/docs/shared-mutable-state-and-concurrency.html
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.sync/-mutex/
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-mutable-state-flow/
  - https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/as-context-element.html
---
- **Lost updates**: `state.value = state.value.copy(…)`, `count.value++` or `list += x` from coroutines on `Dispatchers.Default`/`IO` (or several `launch`es) → concurrent read-modify-write drops updates. Fix: `MutableStateFlow.update { }`, atomics, or a single-threaded/Mutex-guarded owner.
- **Mutex is non-reentrant**: calling a function that `withLock`s the same `Mutex` from inside `withLock` suspends forever → deadlock. Fix: split locked/unlocked variants; never nest the same mutex.
- **@Synchronized suspend fun**: the monitor is released at the first suspension point, so later parts run unguarded (the compiler rejects suspension inside `synchronized {}` but not this) → races. Fix: `Mutex.withLock`.
- **JVM locks across suspension**: `ReentrantLock.lock()` … suspend call … `unlock()` may resume on another thread → `IllegalMonitorStateException` or a lock held while suspended. Fix: `Mutex`, or no suspension while holding JVM locks.
- **ThreadLocal context**: MDC, security or transaction `ThreadLocal`s read after a suspension may be missing or belong to another request. Fix: `threadLocal.asContextElement(value)` (`MDCContext` for SLF4J), or pass values explicitly.
- **Unsafe collections**: plain `HashMap`/`ArrayList` mutated from coroutines on multi-threaded dispatchers → corruption, `ConcurrentModificationException`. Fix: confine to one dispatcher or use concurrent collections.
