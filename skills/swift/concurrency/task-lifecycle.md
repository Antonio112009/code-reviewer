---
name: Unstructured tasks and cancellation
description: Task lifetime bugs — tasks nobody cancels, loops that retain self, cooperative cancellation never checked, CancellationError swallowed by try?, errors lost in Task {}, Task.detached misuse and cancellation handlers racing their operation.
tags: [CWE-401, CWE-755]
activation:
  content:
    - '\bTask\s*(?:\(|\{|\.detached\b|\.sleep\b|\.checkCancellation\b|\.isCancelled\b)'
    - '\.cancel\(\)|\bwithTaskCancellationHandler\b|\bfor\s+(?:try\s+)?await\b'
  examples:
    - 'self.refreshTask = Task { await self.refresh() }'
    - 'refreshTask?.cancel()'
sources:
  - https://developer.apple.com/documentation/swift/task
  - https://developer.apple.com/documentation/swift/task/sleep(nanoseconds:)
  - https://developer.apple.com/documentation/swift/withtaskcancellationhandler(operation:oncancel:isolation:)
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0520-discardableresult-task-initializers.md
---
- **Nobody cancels it**: `Task { }` started in `init`, `viewDidLoad` or `onAppear` without keeping the handle and cancelling it on teardown → keeps running after its owner is gone; dropping the handle doesn't cancel.
- **Loops retain self**: a task looping over a stream (`for await`) or polling keeps `self` alive until the loop ends; `guard let self` at the top re-pins a weak capture for the whole loop. Fix: unwrap per iteration.
- **Cancellation never checked**: CPU-bound loops and batch jobs without `try Task.checkCancellation()` or `Task.isCancelled` run to completion after cancel.
- **Swallowed CancellationError**: `try? await Task.sleep(...)` in retry or poll loops ignores cancellation → the loop spins forever after cancel. Fix: `try await` and exit on `CancellationError`.
- **Lost errors**: `Task { try await save() }` whose `value` is never awaited drops the error silently (Swift 6.4 warns, SE-0520). Fix: `do/catch` inside the task and report.
- **Detached and nested tasks**: `Task.detached` used to "leave the main actor" drops task-locals and isn't cancelled with its parent; a `Task {}` inside a task isn't a child either. Fix: `async let`/task groups or a `@concurrent` async function.
- **onCancel races**: `withTaskCancellationHandler`'s `onCancel` may run concurrently with the operation, or immediately if already cancelled → shared state needs synchronisation; the operation must still finish exactly once.
