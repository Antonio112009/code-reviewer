---
name: Sendable escape hatches and locks
description: Data races hidden from the compiler by @unchecked Sendable, nonisolated(unsafe) and @preconcurrency, non-atomic lazy properties, os_unfair_lock without a stable address, and critical sections that are split or held across await.
tags: [CWE-362, CWE-667]
activation:
  content:
    - '@unchecked\s+Sendable|\bnonisolated\(unsafe\)|@preconcurrency\b|\blazy\s+var\b'
    - '\b(?:os_unfair_lock\w*|pthread_mutex\w*|OSAllocatedUnfairLock|Mutex|NSLock|NSRecursiveLock)\b|\bwithLock(?:Unchecked)?\b|\buncheckedState:'
sources:
  - https://developer.apple.com/documentation/os/osallocatedunfairlock
  - https://docs.swift.org/swift-book/documentation/the-swift-programming-language/properties/
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0423-dynamic-actor-isolation.md
  - https://developer.apple.com/videos/play/wwdc2021/10254/
---
- **@unchecked Sendable over mutable state**: a class marked `@unchecked Sendable` whose `var`s aren't all guarded by one lock or queue on every read and write → races the compiler no longer reports. Fix: state inside `Mutex`/`OSAllocatedUnfairLock`, or an actor.
- **nonisolated(unsafe)**: on mutable globals, statics or properties written from several tasks → data races. Only for state that is immutable after initialisation or externally synchronised.
- **@preconcurrency hiding real crossings**: `@preconcurrency import` or conformances silence Sendable errors for values that really move between actors or tasks → hidden races.
- **lazy isn't atomic**: a `lazy var` on a shared object read from several threads can initialise twice → duplicate state or "singletons"; `static let` and globals initialise exactly once. Fix: `static let`, eager init or a lock.
- **os_unfair_lock by value**: an `os_unfair_lock`/`pthread_mutex_t` stored in a Swift property and passed with `&` has no stable address → the wrong memory gets locked. Fix: `OSAllocatedUnfairLock` (iOS 16+) or `Mutex` (Synchronization, iOS 18+).
- **Split critical sections**: `withLock { read }` followed by a separate `withLock { write }` → check-then-act race; `withLockUnchecked` returning non-Sendable references lets state escape the lock. Fix: one critical section per decision.
- **Locks across suspension**: a lock taken before an `await` and released after → deadlocks, and an unfair lock unlocked on another thread traps. Fix: never hold locks across `await`; use an actor.
