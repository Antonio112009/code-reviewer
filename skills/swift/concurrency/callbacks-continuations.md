---
name: Completion handlers and continuations
description: Callback and continuation contracts — completion called exactly once on every path, continuations resumed exactly once including error and cancellation paths, and one stored continuation shared by concurrent calls.
tags: [CWE-754]
activation:
  content:
    - '\bwith(?:Checked|Unsafe)(?:Throwing)?Continuation\b|\bcontinuation\.resume\b|\b(?:Checked|Unsafe)Continuation\b'
    - '\bcompletion(?:Handler)?\s*[:(]|@escaping\s*(?:@\w+\s*)?\('
  examples:
    - 'return try await withCheckedThrowingContinuation { continuation in'
    - 'func loadUser(completion: @escaping (Result<User, Error>) -> Void) {'
sources:
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0300-continuation.md
  - https://developer.apple.com/documentation/swift/withcheckedthrowingcontinuation(isolation:function:_:)
  - https://developer.apple.com/documentation/swift/withtaskcancellationhandler(operation:oncancel:isolation:)
---
- **Exactly once on every path**: a `guard … else { return }` that never calls `completion`, or a missing `return` after `completion(.failure(e))` that then also calls `completion(.success)` → caller hangs or handles the result twice.
- **Resumed twice**: resuming in both the error and the success path, or in a delegate method that fires repeatedly → `CheckedContinuation` traps, `UnsafeContinuation` is undefined behaviour.
- **Never resumed**: error, timeout, cancellation or "delegate never called back" paths that don't resume → the awaiting task hangs forever and leaks what it holds (only checked continuations log "leaked its continuation").
- **One stored continuation**: delegate-based wrappers keeping a single continuation property → a second concurrent call overwrites it; the first caller hangs or gets the second call's result. Fix: reject or queue concurrent calls; key continuations per request.
- **Cancellation ignored**: `withChecked…Continuation` doesn't react to task cancellation. Fix: wrap it in `withTaskCancellationHandler` to cancel the underlying work, and still resume once.
