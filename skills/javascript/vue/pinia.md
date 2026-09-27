---
name: Pinia stores
description: Pinia 2/3 store misuse — destructuring without storeToRefs, incomplete setup stores, stores used before install or shared across SSR requests, $reset on setup stores, array $patch and subscription lifetimes.
priority: 62
activation:
  content:
    - "\\bdefineStore\\s*\\("
    - "\\bstoreToRefs\\b"
    - "from ['\"]pinia['\"]"
    - "\\buse[A-Z]\\w{0,60}Store\\s*\\("
    - "\\$(?:patch|reset|subscribe|onAction)\\s*\\("
sources:
  - https://pinia.vuejs.org/core-concepts/
  - https://pinia.vuejs.org/core-concepts/outside-component-usage.html
  - https://pinia.vuejs.org/core-concepts/state.html
  - https://github.com/vuejs/pinia/blob/v3/packages/pinia/src/store.ts
---
- **Destructured store**: `const { items, total } = useCartStore()` → plain copies; the UI stops updating. Fix: `storeToRefs(store)` for state and getters; destructure actions directly.
- **Incomplete setup store**: a setup store keeping some state `ref` unreturned (private) or returning it `readonly` → breaks SSR state transfer, devtools and plugins. Fix: return every state ref; move private state to another store.
- **Store before install**: `useStore()` at module top level (router files, API clients, utils) → throws before `app.use(pinia)`, or on the server binds one global store shared by all requests. Fix: call inside functions/guards; pass the request's `pinia` during SSR.
- **$reset on setup stores**: `store.$reset()` on a setup (function) store throws in dev and silently does nothing in production. Fix: implement your own `$reset` action.
- **Array $patch**: `$patch({ items: [newItem] })` replaces the whole array (objects are merged, arrays are not) → existing items lost. Fix: function form `$patch(s => { s.items.push(newItem) })`.
- **Subscription lifetime**: `$subscribe`/`$onAction` inside a component stop on unmount; in module scope or when detached (`{ detached: true }` / `$onAction(cb, true)`) they live forever → leaks, duplicate side effects. Fix: detach only on purpose; call the unsubscribe.
