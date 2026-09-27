---
tier: full
name: Swift Testing and XCTest
description: Tests that pass while broken or flake — Swift Testing's default parallelism over shared state, XCTest assertions inside @Test functions, confirmation() timing, force-unwrapping after #expect and async work the test never awaits.
activation:
  files: ['**/*Tests.swift', '**/*Test.swift', '**/Tests/**/*.swift']
  content: ['^[ \t]*import[ \t]+(?:Testing|XCTest)\b', '@(?:Test|Suite)\b|#(?:expect|require)\(|\bXCTAssert\w*\(|\bconfirmation\(']
sources:
  - https://developer.apple.com/documentation/testing/parallelization
  - https://developer.apple.com/documentation/testing/migratingfromxctest
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/testing/0021-targeted-interoperability-swift-testing-and-xctest.md
---
- **Parallel by default**: Swift Testing runs tests and parameterized cases concurrently in one process → tests sharing singletons, statics, `UserDefaults.standard`, files or a global `URLProtocol` stub interfere and flake. Fix: per-test state, or `.serialized` on the suite.
- **Assertions from the other framework**: `XCTAssert*` inside `@Test` functions (or `#expect` inside `XCTestCase`) were silently ignored before Swift 6.4; 6.4 fails them only in "complete" interop mode — the "limited" default for older tools versions just warns. Fix: `#expect`/`#require`.
- **Late confirmations**: `confirmation { }` checks its count when the closure returns → callbacks or notifications that fire afterwards are reported missing or never checked. Fix: await the work inside; bridge callbacks with continuations.
- **Unwrap after expect**: `#expect(x != nil)` followed by `x!` crashes the whole test process instead of failing one test. Fix: `let x = try #require(x)`.
- **Unawaited work**: a test that starts `Task { }` or callback work and returns without awaiting → its assertions never run and it passes vacuously. Fix: await the task or `await fulfillment(of:timeout:)`.
