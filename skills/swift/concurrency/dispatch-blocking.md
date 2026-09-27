---
name: GCD and blocking in async code
description: Blocking primitives inside Swift concurrency's cooperative pool, DispatchQueue.sync deadlocks, barriers on global queues, unbalanced DispatchGroup enter/leave and thread explosion from blocking work on concurrent queues.
tags: [CWE-833, CWE-667]
activation:
  content: ['\bDispatch(?:Queue|Group|Semaphore|WorkItem)\b|\.sync\s*(?:\(|\{)|\.(?:wait|enter|leave)\(\)|\bThread\.sleep\b|\busleep\(|\bOperationQueue\b|\.barrier\b']
sources:
  - https://developer.apple.com/videos/play/wwdc2021/10254/
  - https://developer.apple.com/documentation/dispatch/dispatchqueue/sync(execute:)-3segw
  - https://developer.apple.com/documentation/dispatch/dispatch_barrier_async
  - https://developer.apple.com/documentation/dispatch/dispatchgroup/leave()
---
- **Semaphores in async code**: `DispatchSemaphore.wait()`, `DispatchGroup.wait()`, `Thread.sleep` or synchronous I/O inside async functions (often in a sync helper) block one of the few cooperative-pool threads → starvation or deadlock. Fix: `await` the work.
- **Sync-over-async**: `Task { …; sem.signal() }` followed by `sem.wait()` to make async code synchronous → deadlocks when called on the main thread or from the pool. Fix: make the caller async.
- **sync on the current queue**: `DispatchQueue.main.sync` from the main thread, or `queue.sync` from a block already on that serial queue → deadlock. Fix: `async`, or check where the code runs.
- **Barriers on global queues**: `.barrier` flags on `DispatchQueue.global()` behave like plain `async` → reader/writer "locks" don't exclude anything. Fix: a private concurrent queue, or a lock/actor.
- **Unbalanced groups**: a `leave()` missing on an error path means `notify` never fires; an extra `leave()` crashes. Fix: `defer { group.leave() }` right after `enter()`.
- **Thread explosion**: many blocking work items on concurrent queues make GCD spawn more threads → memory and context-switch overhead. Fix: limit concurrency (serial queue, `OperationQueue.maxConcurrentOperationCount`).
