---
name: Condition variables
description: Condition variable misuse — waits without a predicate loop, predicate state changed outside the mutex, notifications without state, notify_one with mixed waiters, ignored timeouts and clock problems in timed waits.
priority: 65
tags: [CWE-662, CWE-833]
activation:
  content:
    - '\bcondition_variable(?:_any)?\b|\bpthread_cond_\w+\s*\(|\bcnd_(?:wait|timedwait|signal|broadcast)\s*\('
    - '\.(?:wait|wait_for|wait_until|notify_one|notify_all)\s*\('
sources:
  - https://en.cppreference.com/w/cpp/thread/condition_variable
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-wait
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/concurrency-con/con38-c/
  - https://gcc.gnu.org/bugzilla/show_bug.cgi?id=41861
---
- **No predicate loop**: `cv.wait(lock)` or `pthread_cond_wait` guarded by `if` instead of `while` → spurious or stolen wakeups continue with the condition false (CP.42). Fix: `cv.wait(lock, pred)` or a loop.
- **State changed without the mutex**: the predicate variable updated without holding the mutex — even if it is atomic — before notifying → the waiter can miss it and sleep forever. Fix: modify under the lock, then notify.
- **Notify without state**: a condition variable used as an event with no shared flag → notifications sent before the waiter blocks are lost. Fix: always pair it with predicate state.
- **notify_one with mixed waiters**: threads waiting for different predicates on one condition variable → the woken thread may be unable to proceed while others stall (CON38-C). Fix: `notify_all`, or separate condition variables.
- **Ignored timeouts**: the `bool` from `wait_for(lock, d, pred)`/`wait_until` or `cv_status::timeout` ignored → code proceeds as if the condition held. Fix: branch on the result.
- **Clock jumps**: deadlines built on `system_clock` shift with wall-clock changes; libstdc++ before GCC 10 (or glibc < 2.30) waited on the system clock even for `steady_clock`. Fix: `steady_clock` deadlines on current toolchains.
