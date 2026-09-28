---
name: Main actor and UI thread isolation
description: UI state touched off the main thread, MainActor.assumeIsolated in callbacks delivered on any queue, heavy synchronous work in tasks that inherit the main actor, and block observers running on the posting thread.
tags: [CWE-362]
activation:
  content:
    - '@MainActor\b|\bMainActor\.(?:run|assumeIsolated)\b|\bDispatchQueue\.main\b|\bThread\.isMainThread\b'
    - '\bnonisolated\b|@preconcurrency\b|\bqueue:\s*nil\b|\bdelegateQueue:|\.receive\(on:'
    - '\bTask\s*(?:\(\s*(?:priority:\s*\.\w+\s*)?\)\s*)?\{'
  examples:
    - '@MainActor final class ProfileViewModel: ObservableObject {'
    - 'NotificationCenter.default.addObserver(forName: .userDidLogin, object: nil, queue: nil) { _ in }'
    - 'Task { expensiveParse(data) }'
sources:
  - https://developer.apple.com/documentation/swift/mainactor
  - https://developer.apple.com/documentation/foundation/notificationcenter/addobserver(forname:object:queue:using:)
---
- **UI state from background callbacks**: `@Published`/`@Observable` properties or UIKit objects mutated in URLSession, Core Location, delegate or SDK callbacks on background queues → races, "Publishing changes from background threads" warnings, crashes. Fix: `@MainActor` isolation or hop to main.
- **assumeIsolated off main**: `MainActor.assumeIsolated { }` in a callback the framework may deliver on any queue → crash. Use it only where main-thread delivery is documented.
- **Tasks inherit the main actor**: `Task { expensive() }` created in views, view models or other `@MainActor` code runs its synchronous work on the main thread → UI hangs. Fix: `await` a `nonisolated`/`@concurrent` async function instead.
- **Posting-thread observers**: `addObserver(forName:object:queue: nil)` blocks run on whichever thread posted → main-actor state mutated off-main. Fix: `queue: .main` or hop explicitly.
