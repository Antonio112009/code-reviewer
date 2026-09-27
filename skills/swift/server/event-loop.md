---
name: Event loops and blocking on the server
description: SwiftNIO/Vapor throughput killers — wait() on an event loop, blocking I/O and sleeps in handlers, CPU-heavy hashing on the loop, unsynchronised shared state across event loops and promises that are never completed.
tags: [CWE-400, CWE-362, CWE-833]
activation:
  content:
    - '\.wait\(\)|\bEventLoop(?:Future|Promise|Group)?\b|\bmakePromise\(|\bthreadPool\b|\bNIOThreadPool\b|\brunIfActive\('
    - '\bThread\.sleep\b|\busleep\(|\bsleep\(\d|\bDispatchSemaphore\b|\bData\(contentsOf:|\bString\(contentsOf(?:File)?:|\bFileManager\.default\.contents\('
    - '\bBcrypt\.(?:hash|verify)\(|\breq\.password\b|\bapp\.storage\b'
sources:
  - https://docs.vapor.codes/basics/async/
  - https://docs.vapor.codes/security/passwords/
  - https://github.com/apple/swift-nio/blob/main/Sources/NIOCore/EventLoopFuture.swift
---
- **wait() on an event loop**: `.wait()` on an `EventLoopFuture` inside a route handler, middleware or channel handler → assertion failure or deadlock. Fix: `try await future.get()`, or chain futures (Vapor 5 is async-only).
- **Blocking calls**: `Thread.sleep`, `DispatchSemaphore.wait`, synchronous file reads (`Data(contentsOf:)`, `FileManager` contents), blocking DB or HTTP clients inside handlers → every connection on that event loop (or cooperative thread) stalls. Fix: `req.fileio`/NIO file system, async clients, `threadPool.runIfActive`.
- **CPU-heavy work on the loop**: `Bcrypt.hash`/`verify` (cost 12 by default), image processing or huge JSON encoding in handlers → latency spikes and an easy DoS. Fix: `req.password.async`, or offload to the thread pool.
- **Shared mutable state**: handlers run concurrently on several event loops → mutating globals, class properties or caches in `app.storage` without a lock or actor is a data race.
- **Unfulfilled promises**: an `EventLoopPromise` not completed on every path (errors, early returns) leaves the request hanging, and NIO flags leaked promises in debug builds. Fix: `completeWith`, `defer`-based failure paths.
