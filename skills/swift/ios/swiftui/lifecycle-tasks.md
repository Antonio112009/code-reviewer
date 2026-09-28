---
name: SwiftUI lifecycle and async work
description: SwiftUI side effects in the wrong place — tasks started in onAppear, task without id, work in body or init, blocking the main actor inside .task, timers stored in view structs and onChange skipping the initial value.
activation:
  content:
    - '\.onAppear\b|\.onDisappear\b|\.task\s*(?:\(|\{)|\.onChange\(|\.onReceive\('
    - '\bTimer\.publish\(|\.autoconnect\(\)|\b(?:Date|Number|ISO8601Date)Formatter\(\)'
  examples:
    - '.task { await viewModel.load() }'
    - 'let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()'
sources:
  - https://developer.apple.com/documentation/swiftui/view/task(id:name:priority:file:line:_:)
  - https://developer.apple.com/documentation/swiftui/view/task(name:priority:file:line:_:)
  - https://developer.apple.com/documentation/swiftui/view/onchange(of:initial:_:)
---
- **Task in onAppear**: `.onAppear { Task { await load() } }` isn't cancelled on disappear and reruns on every re-appearance (tabs, navigating back) → duplicate requests, updates to dismissed screens. Fix: `.task { }` (auto-cancelled) with idempotent loading.
- **task without id**: `.task { await search(query) }` doesn't rerun when `query` changes → stale results. Fix: `.task(id: query)`, which cancels the previous run first.
- **Work in body or init**: network calls, new formatters, sorting or filtering large arrays in `body` or a view's `init` rerun on every re-evaluation → jank and repeated side effects. Fix: move it to the model or `.task`.
- **Blocking the main actor**: views are `@MainActor` (iOS 18 SDK), so synchronous CPU work or blocking I/O in `.task`/`onAppear` freezes the UI; recent SDKs start `.task` with `Task.immediate`. Fix: `await` a `@concurrent`/nonisolated function.
- **Timers in view structs**: `let timer = Timer.publish(...).autoconnect()` stored in a `View` is recreated whenever the parent re-renders → the timer restarts and may never fire. Fix: own it in a model or `@State`.
- **onChange misses the first value**: `onChange(of:)` doesn't run for the initial value → the first state is never processed. Fix: `initial: true` (iOS 17) or `.task(id:)`.
