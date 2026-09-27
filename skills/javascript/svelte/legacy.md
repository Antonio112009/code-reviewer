---
tier: full
name: Legacy components and Svelte 5 migration
description: Svelte 4-style (non-runes) reactivity pitfalls — mutation without assignment, hidden reactive-statement ($:) dependencies and timing, manual store subscriptions — and component-API breaks when moving to Svelte 5.
priority: 56
activation:
  content:
    - "^\\s*\\$:\\s"
    - "\\bexport\\s+let\\s+[\\w$]+\\s*(?:;|$|=(?!\\s*\\$(?:state|derived)\\b))"
    - "\\bnew\\s+[A-Z]\\w{0,60}\\s*\\(\\s*\\{\\s*target\\b"
    - "\\.\\$(?:on|set|destroy)\\s*\\("
    - "\\b(?:mount|hydrate|unmount|flushSync)\\s*\\("
    - "from ['\"]svelte/store['\"]"
sources:
  - https://svelte.dev/docs/svelte/legacy-reactive-assignments
  - https://svelte.dev/docs/svelte/legacy-let
  - https://svelte.dev/docs/svelte/stores
  - https://svelte.dev/docs/svelte/v5-migration-guide
---
- **Mutation without assignment**: in non-runes components `arr.push(x)`, writes through an alias (`const o = obj; o.a = 1`) or `Map`/`Set` methods → no update; only assignments to the variable trigger. Fix: reassign (`arr = [...arr, x]`) or use `$state`.
- **Hidden $: dependencies**: `$: total = sum()` where `sum` reads other variables → only variables referenced in the statement are tracked; stale totals. Fix: pass dependencies as arguments.
- **$: timing**: reading a `$:`-derived value right after changing its inputs in the same handler → still the old value until the next update. Fix: compute directly, or `await tick()`.
- **Manual store subscriptions**: `store.subscribe(…)` in components or modules without calling the returned unsubscribe → leaks and stale handlers. Fix: `$store` auto-subscription, or unsubscribe in `onDestroy`.
- **Svelte 5 component API**: `new Component({ target })`, `$on`, `$set` no longer exist (components are functions) → runtime TypeErrors in imperative mounting code. Fix: `mount()`/`hydrate()`, callback props, `$state` props.
- **mount() timing**: code assuming the component rendered right after `mount()` → effects and `onMount` haven't run yet. Fix: `flushSync()` when synchronous access is required.
