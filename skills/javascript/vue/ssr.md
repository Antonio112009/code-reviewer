---
name: SSR and hydration
description: Vue server-side rendering defects — cross-request state pollution, browser APIs and timers during setup, hydration mismatches, unstable ids and unsafe serialization of initial state.
priority: 66
activation:
  content:
    - "\\b(?:createSSRApp|renderToString|renderToNodeStream|renderToWebStream|pipeToNodeWritable|useSSRContext)\\b"
    - "\\bonServerPrefetch\\s*\\("
    - "\\bimport\\.meta\\.env\\.SSR\\b"
    - "\\bdata-allow-mismatch\\b"
    - "\\b(?:useId|hydrateOn(?:Idle|Visible|MediaQuery|Interaction))\\s*\\("
    - "__(?:INITIAL_STATE|PINIA|APOLLO_STATE)__"
  files: ["**/entry-server.{ts,js}", "**/entry-client.{ts,js}"]
  versions: { framework.vue: ">=3" }
sources:
  - https://vuejs.org/guide/scaling-up/ssr.html
  - https://vuejs.org/api/ssr.html
  - https://vuejs.org/api/composition-api-helpers.html#useid
  - https://pinia.vuejs.org/ssr/
---
- **Cross-request pollution**: module-level `ref`/`reactive`, stores, routers or caches created at import time and written during rendering → one user's data served to another. Fix: create app, router and store per request inside a factory.
- **Browser APIs in setup**: `window`, `document`, `localStorage`, `matchMedia` used in setup or `created` → server crash. Fix: move into `onMounted`, or guard with `import.meta.env.SSR`.
- **Server-side timers**: intervals, timers or subscriptions started in setup are never cleaned up on the server (unmount hooks don't run there) → per-request leaks. Fix: start them in `onMounted`.
- **Hydration mismatch**: output depending on `Date.now()`, `Math.random()`, locale/timezone, or invalid nesting (`<div>` inside `<p>`) → mismatch warnings and wrong DOM kept. Fix: deterministic render, client-only values after mount; `data-allow-mismatch` (3.5+) only for unavoidable text.
- **Unstable ids**: ids from counters/`Math.random()` for `for`/`aria-*` differ between server and client. Fix: `useId()` (3.5+, not inside `computed`); `app.config.idPrefix` when a page hosts several apps.
- **Unsafe state serialization**: `window.__INITIAL_STATE__ = ${JSON.stringify(state)}` in HTML → `</script>` inside user data breaks out (XSS). Fix: serialize with `devalue`/`serialize-javascript`; hydrate stores before the first `useStore()`.
