---
name: SwiftUI identity and lists
description: View identity bugs in ForEach and List — duplicate or unstable ids, index-based ForEach over mutable data, onDelete offsets applied to a different collection and branch swaps that reset state.
activation:
  content:
    - '\bForEach\s*\(|\bList\s*\(|\.id\(|\bIdentifiable\b|\bid:\s*\\\.\w+'
    - '\.onDelete\b|\.onMove\b|\.enumerated\(\)|\.indices\b|\bAnyView\('
  examples:
    - 'ForEach(items, id: \.id) { item in Text(item.name) }'
    - '.onDelete { indexSet in items.remove(atOffsets: indexSet) }'
sources:
  - https://developer.apple.com/documentation/swiftui/foreach/init(_:id:content:)
  - https://developer.apple.com/documentation/swiftui/foreach
  - https://developer.apple.com/videos/play/wwdc2021/10022/
---
- **Duplicate ids**: `ForEach(items, id: \.self)` over values that can repeat, or `Identifiable` ids that collide → rows show wrong data, animations break, selection jumps.
- **Unstable ids**: `var id: UUID { UUID() }`, `let id = UUID()` on models rebuilt at every fetch, or `.id(UUID())` → identity changes on every update: state, focus and scroll reset, full redraws. Fix: persistent server or database ids.
- **Index-based ForEach**: `ForEach(0..<items.count)`, `items.indices` or `enumerated()` with `id: \.offset` over mutable data → index-out-of-range crashes on delete and state stuck to positions. Fix: iterate elements by stable id; `ForEach($items)` for bindings.
- **onDelete offsets**: `.onDelete { items.remove(atOffsets: $0) }` while the `ForEach` shows a filtered, sorted or searched array → deletes the wrong records. Fix: map offsets to the ids of the displayed collection.
- **Branch swaps**: `if/else` that swaps between two instances of the same view, or `AnyView` wrapping, changes structural identity → state resets and transitions glitch. Fix: one view with modifiers such as `opacity` or `disabled`.
