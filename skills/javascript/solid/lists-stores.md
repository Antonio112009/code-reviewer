---
name: Lists and stores
description: SolidJS list and store defects — .map() in JSX, For/Index accessor misuse, direct mutation of read-only store proxies, full re-renders without reconcile and store values read outside tracking.
priority: 58
activation:
  content:
    - "<(?:For|Index)\\b"
    - "\\bcreate(?:Store|Mutable)\\s*[(<]"
    - "\\b(?:produce|reconcile|unwrap)\\s*\\("
    - "\\)\\.map\\s*\\(\\s*\\(?[a-zA-Z_$]"
  versions: { framework.solid: "<2" }
sources:
  - https://docs.solidjs.com/concepts/control-flow/list-rendering
  - https://docs.solidjs.com/concepts/stores
  - https://docs.solidjs.com/reference/store-utilities/reconcile
---
- **.map() in JSX**: `{items().map(i => <Row …/>)}` → every change recreates all rows (lost focus and state, slow). Fix: `<For each={items()}>`.
- **Accessor misuse**: `<For>` gives `index` as an accessor (`i()`), `<Index>` gives `item` as an accessor (`item()`) → using them as plain values freezes the first value. Fix: call the accessor; `<Index>` for primitives with fixed positions.
- **Direct store mutation**: `store.items.push(x)` or `store.user.name = …` on `createStore` state → ignored (read-only proxy). Fix: `setStore('items', items => [...items, x])` or `produce`.
- **Replacing store data**: `setStore('list', serverData)` with fresh arrays → every row re-rendered. Fix: `reconcile(serverData, { key: 'id' })`.
- **Store reads outside tracking**: `const { user } = store` or `const name = store.user.name` in the component body → not tracked later. Fix: read through the store inside JSX or memos.
