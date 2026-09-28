---
name: Retain cycles and object lifetime
description: ARC leaks and lifetime crashes — closures stored on self, strong delegates, Timer/CADisplayLink targets, block-based observers and KVO tokens, unowned captures that outlive their owner, and self escaping from deinit.
tags: [CWE-401, CWE-416]
activation:
  content:
    - '\[(?:weak|unowned)(?:\(\w+\))?\s+self\]|@escaping\b|\blazy\s+var\b|\bdeinit\b'
    - '\b(?:weak|unowned)\s+(?:var|let)\b|\bvar\s+delegate\b|\bdelegate\s*='
    - '\bTimer\s*\(|\bTimer\.scheduledTimer\b|\bCADisplayLink\b|\baddObserver\(|\.observe\(\\|\bNSKeyValueObservation\b'
  examples:
    - 'networkClient.fetch { [weak self] result in self?.handle(result) }'
    - 'weak var delegate: SessionDelegate?'
    - 'Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(tick), userInfo: nil, repeats: true)'
    - 'let token = progress.observe(\.fractionCompleted) { p, _ in }'
sources:
  - https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting/
  - https://developer.apple.com/documentation/foundation/timer/init(timeinterval:target:selector:userinfo:repeats:)
  - https://developer.apple.com/documentation/foundation/notificationcenter/addobserver(forname:object:queue:using:)
  - https://developer.apple.com/documentation/swift/using-key-value-observing-in-swift
---
- **Closures stored on self**: a closure kept by `self`, or by an object `self` owns (callbacks, `lazy var` closures, child handlers), that captures `self` strongly → cycle; view controllers and view models never deinit. Fix: `[weak self]`.
- **Strong delegate**: `var delegate: SomeDelegate?` without `weak` (protocol not `AnyObject`-bound) → parent/child cycle. Fix: `weak var`, `protocol P: AnyObject`.
- **Timer and display-link targets**: `Timer(target: self…)`, `scheduledTimer(target:…)` and `CADisplayLink(target: self…)` retain the target until invalidated → invalidating in `deinit` never runs. Fix: invalidate on stop/disappear, or block APIs with `[weak self]`.
- **Block observers**: `addObserver(forName:object:queue:using:)` returns a token the center holds strongly with its block → an unstored token can't be removed; a strong `self` leaks and keeps firing. Fix: store and remove the token, capture weakly.
- **KVO tokens**: the `NSKeyValueObservation` from `observe(\.x)` must be stored — dropping it ends observation at once; observed properties need `@objc dynamic` or nothing fires.
- **unowned outliving its owner**: `[unowned self]` in network, animation or async callbacks that can fire after deallocation → crash. Fix: `[weak self]`.
- **self escaping deinit**: `deinit` starting `Task { await self.cleanup() }` or dispatching a closure that captures `self` → fatal "deallocated with non-zero retain count". Fix: capture only the values needed.
