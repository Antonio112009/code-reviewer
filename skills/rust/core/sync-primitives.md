---
name: std::sync and threads
description: Poisoned std locks cascading into panics, non-reentrant locks, Condvar misuse, Relaxed atomics publishing data, panicking lazy initializers and detached threads.
priority: 58
tags: [CWE-362, CWE-667, CWE-833, CWE-820]
activation:
  content:
    - '\bstd::sync\b|\bPoisonError\b|\bis_poisoned\b'
    - '\.lock\(\)\.unwrap\(\)|\.(?:read|write)\(\)\.unwrap\(\)'
    - '\b(?:Condvar|OnceLock|LazyLock|lazy_static!|thread_local!)'
    - '\bAtomic(?:Bool|Usize|Isize|U64|I64|U32|I32|Ptr)\b|\bOrdering::(?:Relaxed|Acquire|Release|AcqRel|SeqCst)\b'
    - '\bthread::(?:spawn|scope|Builder)\b'
  examples:
    - 'use std::sync::{Arc, Mutex};'
    - 'let guard = mutex.lock().unwrap();'
    - 'static CONFIG: OnceLock<Config> = OnceLock::new();'
    - 'static COUNTER: AtomicUsize = AtomicUsize::new(0);'
    - 'let handle = thread::spawn(move || worker());'
sources:
  - https://doc.rust-lang.org/std/sync/struct.Mutex.html#poisoning
  - https://doc.rust-lang.org/std/sync/struct.RwLock.html
  - https://doc.rust-lang.org/std/sync/struct.LazyLock.html
  - https://doc.rust-lang.org/std/sync/atomic/index.html
---
- **Poison cascade**: after a panic while a std `Mutex`/`RwLock` is held, every `lock().unwrap()` panics → one bad request takes down all workers sharing it. Fix: `unwrap_or_else(PoisonError::into_inner)` when data stays valid, `clear_poison` (1.77), or parking_lot.
- **Re-entrant locking**: a helper that locks the same std lock while the caller holds it, or a second `read()` on one thread while a writer waits → deadlock or panic. Fix: pass the guard or `&mut T` down.
- **Condvar misuse**: `wait` inside an `if` (spurious wakeups) or a flag changed outside the associated mutex (lost wakeup) → proceeds on a false condition or hangs. Fix: `wait_while`, update the predicate under the same mutex.
- **Relaxed publication**: `store(true, Relaxed)` on a flag or pointer that publishes other data → readers see stale data on ARM; load-then-store updates lose increments. Fix: `Release`/`Acquire`, `fetch_add`, `compare_exchange` loops.
- **Panicking lazy init**: a `LazyLock` initializer that panics (missing env var, bad config) poisons it, so every later access panics; `OnceLock::get_or_init` re-entering the same cell deadlocks. Fix: fallible init in `main`, then `OnceLock::set`.
- **Detached threads**: dropped `JoinHandle`s or ignored `join()` results lose panics and errors; returning from `main` kills threads mid-work. Fix: join handles or `thread::scope`.
