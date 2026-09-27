---
name: Actor reentrancy
description: State in actors and @MainActor types that changes across await — check-then-act on stale reads, duplicate in-flight work, invariants split by a suspension point and assumed FIFO ordering of calls.
priority: 58
tags: [CWE-362, CWE-367]
activation:
  content: ['\bactor\s+[A-Z]\w*|@MainActor\b|\bawait\b']
sources:
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0306-actors.md
  - https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/
---
- **Stale read across await**: an actor or `@MainActor` method checks state (`cache[key] == nil`, `balance >= amount`), `await`s, then acts on it → interleaved calls cause double spends, lost updates, stale overwrites. Fix: re-check after `await`; mutate before suspending.
- **Duplicate in-flight work**: cache-miss code in an actor starts the same download or token refresh once per concurrent caller. Fix: store the in-flight `Task` per key and let later callers `await` its `value`.
- **Invariants split by await**: multi-field updates (items + count, token + expiry) with an `await` in between expose half-updated state to other callers. Fix: finish synchronous mutations before suspending, or keep related state in one value.
- **Assumed ordering**: `Task { await store.append(x) }` launched in a loop, or calls from different tasks, don't run in submission order. Fix: a single consumer task reading an `AsyncStream`, or explicit sequence numbers.
