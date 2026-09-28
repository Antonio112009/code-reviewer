---
name: Mutexes and deadlocks
description: Lock misuse in C/C++ — manual lock/unlock around early exits, inconsistent lock order, re-locking non-recursive or shared mutexes, unknown code under locks, guarded data escaping and destroying or foreign-unlocking mutexes.
priority: 65
tags: [CWE-667, CWE-833, CWE-764]
activation:
  content:
    - '\b(?:std::)?(?:mutex|recursive_mutex|timed_mutex|shared_mutex|shared_timed_mutex|lock_guard|unique_lock|scoped_lock|shared_lock)\b'
    - '\bpthread_(?:mutex|rwlock|spin)_\w+\s*\(|\bmtx_(?:lock|unlock|trylock|timedlock|init|destroy)\s*\('
    - '\.(?:lock|unlock|try_lock|lock_shared|unlock_shared)\s*\(\s*\)'
  examples:
    - 'std::lock_guard<std::mutex> lock(mtx);'
    - 'pthread_mutex_lock(&mtx);'
    - 'mtx.unlock();'
sources:
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-raii
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-lock
  - https://en.cppreference.com/w/cpp/thread/shared_mutex/lock
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/concurrency-con/con31-c/
---
- **Manual lock/unlock**: `m.lock()` … `m.unlock()` or `pthread_mutex_lock`/`unlock` with early returns, `goto`s or exceptions in between → the mutex stays locked (CP.20). Fix: `lock_guard`/`scoped_lock`; in C, one cleanup exit.
- **Lock order**: two mutexes taken in different orders on different paths → deadlock under load. Fix: `std::scoped_lock(a, b)` (C++17) or `std::lock`, or one documented order.
- **Re-locking**: code holding a non-recursive mutex calls helpers, callbacks or virtuals that lock it again; `lock()` on a `shared_mutex` while holding its shared lock ("upgrade") → UB, usually self-deadlock. Fix: split locked/unlocked helpers; release before upgrading.
- **Unknown code under a lock**: callbacks, signals/slots, logging or blocking I/O while holding a lock → deadlocks and long stalls (CP.22). Fix: copy what is needed, unlock, then call out.
- **Guarded data escaping**: returning references, pointers or iterators to protected members, or guarding shared static data with a per-object mutex → access without the lock that matters. Fix: return copies; lock the mutex that owns the data.
- **Lifetime and ownership**: destroying a locked mutex, unlocking from a non-owning thread, or ignoring `pthread_mutex_lock` errors (`EOWNERDEAD` on robust mutexes) → UB or corrupted state (CON31-C). Fix: unlock before destroy; check return codes.
