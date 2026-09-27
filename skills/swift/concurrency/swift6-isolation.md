---
name: Swift 6 isolation behaviour changes
description: Runtime and scheduling changes that arrive with the Swift 6 language mode and Swift 6.2 isolation defaults — dynamic actor-isolation traps, checks inserted after a dependency migrates, nonisolated async on the caller's actor, default MainActor isolation, Task.immediate and isolated conformances.
priority: 66
activation:
  versions: { lang.swift: '>=6' }
  content:
    - '@preconcurrency\b|@concurrent\b|\bnonisolated\b|@MainActor\b|\bMainActor\.assumeIsolated\b|\bTask\.immediate\b|\bisolated\s+deinit\b'
    - '\b(?:NonisolatedNonsendingByDefault|InferIsolatedConformances)\b|\bSWIFT_(?:APPROACHABLE_CONCURRENCY|DEFAULT_ACTOR_ISOLATION|STRICT_CONCURRENCY|VERSION)\b|\.(?:defaultIsolation|swiftLanguageMode)\('
sources:
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0423-dynamic-actor-isolation.md
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0470-isolated-conformances.md
---
- **Runtime isolation traps (Swift 6 mode)**: synchronous `@MainActor`/actor-isolated methods and closures invoked on the wrong executor by Objective-C, C or `@preconcurrency` APIs (delegate queues, `queue: nil` observers, SDK callbacks) now crash. Fix: `nonisolated` callback, then hop.
- **Traps without source changes**: when a dependency adopts the Swift 6 mode, rebuilding against it adds checks at your calls to its isolated synchronous APIs; `@preconcurrency` conformances are checked in any mode.
- **Caller-actor async (6.2)**: with `NonisolatedNonsendingByDefault` (in Xcode 26's Approachable Concurrency), `nonisolated async` functions run on the caller's actor → heavy work called from UI code runs on the main thread. Fix: `@concurrent`.
- **Default MainActor (6.2)**: `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` or `.defaultIsolation(MainActor.self)` makes unannotated code main-actor isolated → parsing, image and database work moves to the main thread. Fix: `nonisolated`/`@concurrent`.
- **Settings flips**: enabling these in an existing project.pbxproj or Package.swift changes where unchanged code runs — review hot paths and callbacks, not only the diff.
- **Task.immediate (6.2)**: the body runs synchronously on the current executor until its first real suspension → changed ordering; heavy work before the first `await` blocks the caller.
- **Isolated conformances (6.2)**: for a `@MainActor` conformance (explicit or via `InferIsolatedConformances`), `value as? any P` returns `nil` off the main actor → silent fallbacks in generic code.
