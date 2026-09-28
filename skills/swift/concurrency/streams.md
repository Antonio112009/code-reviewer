---
name: AsyncSequence and Combine streams
description: Streams of values over time — AsyncStream that never finishes or cleans up, unbounded buffering, multiple consumers, values dropped when bridging subjects, Combine subscriptions not stored or retaining self, catch ending pipelines, eager Future and @Published willSet timing.
tags: [CWE-401, CWE-400]
activation:
  content:
    - '\bAsync(?:Throwing)?Stream\b|\bonTermination\b|\.values\b|\bnotifications\(named:'
    - '\bAnyCancellable\b|\.sink\s*[({]|\.assign\(to:|\b(?:PassthroughSubject|CurrentValueSubject)\b|@Published\b'
    - '\bFuture\s*[<({]|\.catch\s*[({]|\.replaceError\(|\.receive\(on:|\beraseToAnyPublisher\('
  examples:
    - 'let stream = AsyncStream<Event> { continuation in'
    - 'subject.sink { value in print(value) }.store(in: &cancellables)'
    - 'return publisher.receive(on: DispatchQueue.main).eraseToAnyPublisher()'
sources:
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0314-async-stream.md
  - https://github.com/swiftlang/swift/blob/main/stdlib/public/Concurrency/AsyncStreamBuffer.swift
  - https://developer.apple.com/documentation/combine/passthroughsubject
  - https://developer.apple.com/documentation/combine/publisher/assign(to:on:)
---
- **Unfinished streams**: an `AsyncStream` continuation never `finish()`ed keeps `for await` loops alive forever; without `onTermination`, observers, timers or sockets feeding it keep running after the consumer cancels.
- **Unbounded buffering**: the default policy buffers every element until consumed → fast producer plus slow consumer grows memory. Fix: `.bufferingNewest(n)`/`.bufferingOldest(n)`.
- **Several consumers**: iterating one `AsyncThrowingStream` from two tasks is a fatal error; `AsyncStream` splits elements between consumers instead of broadcasting. Fix: one stream per consumer.
- **Dropped values**: `PassthroughSubject` drops values without demand, so `for await x in subject.values` misses events emitted while the loop body awaits. Fix: `buffer` operator or an `AsyncStream`.
- **Subscriptions**: a `sink`/`assign` result not stored is cancelled immediately; `assign(to:on: self)` kept in `self.cancellables` retains `self` → leak. Fix: store cancellables, `assign(to: &$prop)` or `[weak self]` sinks.
- **catch ends the pipeline**: `catch`/`replaceError` at the end of a long-lived chain (text field → `flatMap` request) completes it after the first error → no further updates. Fix: catch inside `flatMap`.
- **Eager Future**: `Future { }` runs its closure immediately on creation, once → work happens without subscribers and retries don't re-run it. Fix: `Deferred { Future { } }`.
- **Timing and threads**: `@Published` emits in `willSet` (reading the property in `sink` gives the old value), and values arrive on the upstream's thread → UI needs `receive(on:)` main.
