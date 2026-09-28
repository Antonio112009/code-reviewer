---
name: SwiftUI navigation and presentation
description: Navigation and modal bugs — destinations built eagerly by NavigationLink, navigationDestination inside lazy containers, sheets and alerts reading separately stored state.
activation:
  content:
    - '\bNavigation(?:Link|Stack|SplitView|View|Path)\b|\.navigationDestination\('
    - '\.(?:sheet|fullScreenCover|popover|alert|confirmationDialog)\('
  examples:
    - 'NavigationStack { NavigationLink(value: item) { Text(item.title) } }'
    - '.sheet(item: $selectedItem) { item in DetailView(item: item) }'
sources:
  - https://developer.apple.com/documentation/swiftui/view/navigationdestination(for:destination:)
  - https://developer.apple.com/documentation/swiftui/view/sheet(item:ondismiss:content:)
  - https://developer.apple.com/documentation/swiftui/view/alert(_:ispresented:presenting:actions:)
---
- **Eager destinations**: `NavigationLink(destination: DetailView(model: Model(id)))` builds every destination and runs its init work while the list renders. Fix: value-based `NavigationLink(value:)` with `.navigationDestination(for:)` (iOS 16+).
- **Destination inside lazy containers**: `.navigationDestination` attached inside `List`, `LazyVStack` or `ForEach` rows isn't seen by the stack → links silently fail. Fix: attach it outside the lazy container.
- **Sheet with separate state**: `.sheet(isPresented:)` whose content reads a separately set `@State var selected` → the first presentation can show stale or `nil` data. Fix: `.sheet(item: $selected)`.
- **Alert acting on stale items**: `.alert`/`.confirmationDialog` actions that read an item stored elsewhere → delete or confirm the wrong record after the selection changes. Fix: the `presenting:` variants that pass the item to the actions.
