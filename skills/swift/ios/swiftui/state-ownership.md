---
name: SwiftUI state ownership
description: Who owns SwiftUI state — @ObservedObject that creates its object, @State/@StateObject seeded from init arguments, non-private state, @State holding @Observable models with side-effecting initialisers, missing environment objects and bindings to copies.
activation:
  content:
    - '@(?:State|StateObject|ObservedObject|EnvironmentObject|Bindable|Binding)\b|@Environment\(\s*\w+\.self'
    - '\b_\w+\s*=\s*(?:State|StateObject|Binding)\(|\.environment(?:Object)?\(|\bBinding\((?:get|projectedValue):|\.constant\('
sources:
  - https://developer.apple.com/documentation/swiftui/stateobject
  - https://developer.apple.com/documentation/swiftui/state
  - https://developer.apple.com/documentation/swiftui/observedobject
  - https://developer.apple.com/documentation/swiftui/environment/init(_:)-7pint
---
- **ObservedObject that creates**: `@ObservedObject var vm = ViewModel()` (or a new instance passed from the parent's `body`) → recreated whenever the view is re-initialized; state and in-flight work are lost. Fix: `@StateObject` (`@State` for `@Observable`) in the owning view.
- **State seeded from init**: `_vm = StateObject(wrappedValue: VM(id: id))` or `_text = State(initialValue: value)` uses only the first value; later `id` changes are ignored → stale screen. Fix: `.id(id)` on the view, or react with `.task(id:)`/`onChange`.
- **Non-private state**: `@State`/`@StateObject` set through the memberwise initializer conflicts with SwiftUI's storage → parent updates are ignored. Fix: `private`, and pass values or `@Binding` instead.
- **@State with an @Observable model**: its initial-value expression runs every time the view struct is created (unlike `@StateObject`'s autoclosure) → repeated allocations, network calls or observers from the model's `init`. Fix: cheap init; start work in `.task`.
- **Missing environment object**: `@EnvironmentObject` or non-optional `@Environment(Model.self)` crash when an ancestor didn't inject it — new windows, `UIHostingController` roots, previews. Fix: inject at every root, or declare the optional `Model?` form.
- **Bindings to copies**: `.constant(x)` or `Binding(get:set:)` capturing a local copy in production code → edits are silently discarded.
