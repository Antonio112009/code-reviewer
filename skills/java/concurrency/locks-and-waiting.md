---
name: Locks, monitors and interruption
description: Lock acquisition outside try/finally, synchronizing on shared or changing objects, wait/notify misuse, lock-order deadlocks, blocking while holding locks, swallowed InterruptedException and read-to-write lock upgrades.
priority: 64
tags: [CWE-667, CWE-833, CWE-391]
activation:
  content:
    - '\bsynchronized\b'
    - '\.(?:lock|unlock|tryLock|lockInterruptibly)\(\s*\)'
    - '\bInterruptedException\b'
    - '\.(?:wait|notify|notifyAll)\(\s*\)'
    - '\bReentrant(?:ReadWrite)?Lock\b|\bStampedLock\b'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Lock.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#wait(long)
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html
---
- **Lock outside try/finally**: `lock()` placed inside the `try`, or statements between `lock()` and `try` → an exception leaves the lock held forever, or `unlock()` of an unheld lock throws. Fix: `lock.lock(); try { … } finally { lock.unlock(); }`.
- **Wrong monitor**: `synchronized` on boxed values, string literals, `getClass()` or a reassigned non-final field → unrelated code shares the lock, or threads lock different objects. Fix: `private final Object lock = new Object()`.
- **wait/notify**: `wait()` without a `while` loop re-checking the condition (spurious wakeups, missed signals); `notify()` with waiters on different conditions wakes the wrong thread. Fix: guarded loops, `notifyAll` or `Condition`s.
- **Lock ordering**: code paths taking the same locks in different orders → deadlock under load. Fix: one global order, or `tryLock` with a timeout.
- **Blocking under a lock**: I/O, remote calls, `Thread.sleep` or callbacks into foreign code while holding a lock → throughput collapse and deadlocks. Fix: copy state, release, then do slow work.
- **Swallowed interrupts**: `catch (InterruptedException e) {}` or log-and-continue clears the interrupt flag → shutdown and cancellation hang. Fix: `Thread.currentThread().interrupt()` and exit, or rethrow.
- **Lock upgrade**: taking the write lock of a `ReentrantReadWriteLock` while holding its read lock deadlocks (no upgrades). Fix: release the read lock, then re-check under the write lock.
