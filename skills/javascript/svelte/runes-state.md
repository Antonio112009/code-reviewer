---
name: $state reactivity
description: Svelte 5 $state pitfalls — destructured or copied state, reassigned state exported from modules, non-proxied Map/Set/Date/class values, mutated $state.raw, proxy identity, proxies passed to external APIs and detached methods.
priority: 64
activation:
  files: ["**/*.svelte.{js,ts}"]
  content:
    - "\\$state(?:\\.raw|\\.snapshot)?\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "\\bSvelte(?:Map|Set|Date|URL|URLSearchParams)\\b"
  versions: { framework.svelte: ">=5" }
sources:
  - https://svelte.dev/docs/svelte/$state
  - https://svelte.dev/docs/svelte/svelte-reactivity
  - https://svelte.dev/docs/svelte/runtime-warnings
---
- **Destructured state**: `let { count } = state` or passing `state.count` into a function → a snapshot that never updates. Fix: read `state.count` where needed; pass the object or a getter.
- **Exported reassigned state**: a `$state` variable that is reassigned and exported from a `.svelte.js`/`.svelte.ts` module → importers never see updates. Fix: export an object and mutate its properties, or export getter/setter functions.
- **Non-proxied values**: `Map`, `Set`, `Date`, `URL` or class instances inside `$state` are not deeply reactive → `.set()`, `.add()`, `setHours()` or field writes don't update the UI. Fix: `SvelteMap`/`SvelteSet`/`SvelteDate` (values still not deep) or `$state` class fields.
- **Mutating $state.raw**: `raw.push(x)` or `raw.prop = v` on `$state.raw` data → no update. Fix: reassign a new array/object.
- **Proxy identity**: `indexOf`, `includes` or `===` between a raw object and its `$state` proxy → no match (`state_proxy_equality_mismatch`). Fix: compare ids, or only keep proxied references.
- **Proxies to external APIs**: passing `$state` proxies to `structuredClone`, `postMessage`, IndexedDB or libraries expecting plain objects → `DataCloneError` or odd behavior. Fix: `$state.snapshot(value)`.
- **Detached methods**: class methods using `this` with `$state` fields passed as `onclick={obj.method}` → `this` is undefined. Fix: arrow-function fields or `() => obj.method()`.
