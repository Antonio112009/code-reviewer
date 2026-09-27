---
name: Task groups and async let
description: Structured concurrency pitfalls — unbounded fan-out in task groups, results consumed in completion order, child errors silently dropped, async let cancelled at scope exit and result buffering in long-running groups.
activation:
  content: ['\bwith(?:Throwing)?(?:Discarding)?TaskGroup\b|\.addTask(?:UnlessCancelled)?\b|\basync\s+let\b|\.waitForAll\(|\bgroup\.next\(']
sources:
  - https://developer.apple.com/documentation/swift/withthrowingtaskgroup(of:returning:isolation:body:)
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0317-async-let.md
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0381-task-group-discard-results.md
  - https://github.com/apple/swift-migration-guide/blob/main/Guide.docc/RuntimeBehavior.md
---
- **Unbounded fan-out**: `addTask` for every item of a large or unknown list (uploads, rows, URLs) → thousands of tasks, memory spikes, server rate limits. Fix: start N tasks and add the next one as each result arrives.
- **Completion order**: `for await result in group` yields in completion order, not submission order → results attached to the wrong inputs. Fix: return `(index, value)` pairs or keys.
- **Dropped child errors**: in `withThrowingTaskGroup`, a child's error is rethrown only by `next()`/iteration; a body that never consumes results "succeeds" and siblings keep running. Fix: `for try await` over the group, or a throwing discarding group.
- **async let never awaited**: an `async let` not awaited is cancelled and implicitly awaited at scope exit, and its errors are discarded → "fire-and-forget" work silently doesn't happen. Fix: `await` it, or use an owned `Task`.
- **Results kept forever**: `withTaskGroup` in accept loops or long streams retains each finished child's result until `next()` → unbounded memory growth. Fix: `withDiscardingTaskGroup`/`withThrowingDiscardingTaskGroup` (Swift 5.9+).
