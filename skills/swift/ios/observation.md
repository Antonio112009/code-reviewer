---
name: Observation framework
description: Observation-based models (@Observable, iOS 17+) — updates only for properties read in body, one-shot willSet semantics of withObservationTracking, coalescing in Observations (Swift 6.2), unisolated observable models mutated from background tasks, and changes lost in nested observable objects.
activation:
  content:
    - '@Observable\b|@ObservationIgnored\b|@Bindable\b|\bwithObservationTracking\b|\bwithContinuousObservationTracking\b|\bObservations\s*[({]'
    - '\bObservableObject\b|\bobjectWillChange\b'
  examples:
    - '@Observable final class ProfileModel {'
    - 'class LegacyViewModel: ObservableObject {'
sources:
  - https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0506-advanced-observation-tracking.md
  - https://github.com/swiftlang/swift-evolution/blob/main/proposals/0475-observed.md
---
- **Only what body reads**: SwiftUI re-renders for `@Observable` properties read directly in `body`; values read only in closures, `onAppear` or helpers captured outside `body` don't trigger updates → stale UI. Fix: read what the view shows inside `body`.
- **One-shot tracking**: `withObservationTracking(_:onChange:)` fires once, before the change (willSet) → reading the property in `onChange` sees the old value, and updates stop unless you re-register. Fix: re-register; Swift 6.4 adds `withContinuousObservationTracking`.
- **Coalesced Observations**: `Observations { }` (Swift 6.2) emits the current value first and coalesces changes until the next suspension → intermediate values are skipped; don't treat it as an event log.
- **Unisolated models**: `@Observable` doesn't add actor isolation; view models mutated from background tasks race with SwiftUI reads. Fix: annotate them `@MainActor`.
- **Nested objects**: an `ObservableObject` publishes only when its own `@Published` properties are reassigned → changes inside a nested `ObservableObject` or reference-type property never reach the view. Fix: observe the child directly or migrate both to `@Observable`.
