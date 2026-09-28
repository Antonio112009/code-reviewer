---
name: Reactivity pitfalls
description: Lost or broken Vue 3 reactivity — destructured or replaced reactive state, shallow refs, refs inside collections, proxy identity and class instances that cannot be proxied.
priority: 66
activation:
  content:
    - "(?<![.\\w$])(?:reactive|shallowReactive|shallowRef|toRefs?|toRaw|markRaw|triggerRef|readonly)\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "(?<![.\\w$])ref\\s*(?:<[^>\\n]{0,80}>)?\\("
  examples:
    - 'const state = reactive({ count: 0 });'
    - 'const count = ref(0);'
  versions: { framework.vue: ">=3" }
sources:
  - https://vuejs.org/guide/essentials/reactivity-fundamentals.html
  - https://vuejs.org/api/reactivity-advanced.html
  - https://github.com/vuejs/core/issues/8149
---
- **Destructured reactive**: `const { count } = state` from `reactive()`, or passing `state.count` into a function/composable → a frozen copy. Fix: `toRefs(state)`, `toRef(state, 'count')` or a getter `() => state.count`.
- **Replaced reactive object**: `let state = reactive(…)` later reassigned (`state = reactive(apiResult)`) → no re-render, watchers stay on the old proxy. Fix: use `ref()` and assign `.value`, or `Object.assign(state, apiResult)`.
- **Shallow mutation**: nested writes on `shallowRef`/`shallowReactive` data (`list.value.push(x)`, `s.value.a = 1`) → no update. Fix: replace `.value` or call `triggerRef()`.
- **Refs in collections**: refs inside a reactive array or `Map` are not unwrapped, and templates unwrap only top-level refs (`{{ obj.id + 1 }}` renders "[object Object]1"). Fix: read `.value`; destructure to top level.
- **Proxy identity**: comparing a raw object with its reactive proxy (`===`, `indexOf`, `Set.has`, `Map`/`WeakMap` keys) → never matches. Fix: compare ids, or apply `toRaw()` consistently.
- **Proxied class instances**: SDK clients, class instances with `#private` fields or large immutable data put into `ref`/`reactive` → "Cannot read private member" TypeErrors or deep-proxy overhead. Fix: `markRaw()` or `shallowRef`.
