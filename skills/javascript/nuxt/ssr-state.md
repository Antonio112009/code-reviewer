---
name: SSR state and hydration
description: Nuxt universal-rendering defects — module-level state shared across requests, unserializable or secret useState values, browser APIs during SSR, nondeterministic renders and the removed window.__NUXT__.
priority: 64
activation:
  content:
    - "\\buseState\\s*[(<]"
    - "\\bcallOnce\\s*\\("
    - "\\bimport\\.meta\\.(?:client|server)\\b"
    - "\\bprocess\\.(?:client|server)\\b"
    - "<(?:ClientOnly|client-only)\\b"
    - "\\bwindow\\.__NUXT__\\b"
    - "\\bdefinePayload(?:Reducer|Reviver|Plugin)\\b"
    - "(?<![.\\w$])(?:window|document|localStorage|sessionStorage|navigator)\\."
  examples:
    - 'const cart = useState(''cart'', () => []);'
    - 'await callOnce(''init'', () => seedData());'
    - 'if (import.meta.client) { initWidget(); }'
    - 'if (process.server) { return; }'
    - '<ClientOnly><Widget /></ClientOnly>'
    - 'const state = window.__NUXT__;'
    - 'definePayloadReducer(''Point'', (data) => data instanceof Point && [data.x, data.y]);'
    - 'document.title = pageTitle;'
sources:
  - https://nuxt.com/docs/4.x/api/composables/use-state
  - https://nuxt.com/docs/4.x/getting-started/state-management
  - https://nuxt.com/docs/4.x/guide/best-practices/hydration
  - https://nuxt.com/docs/4.x/getting-started/upgrade
---
- **Module-level state**: `export const cart = ref([])` (or reactive/Map caches) in composables, utils or plugins → one server process shares it across all requests and users. Fix: `useState('cart', () => [])`.
- **Unserializable useState**: class instances, functions or Symbols in `useState` → payload serialization errors; huge objects bloat every HTML response. Fix: plain data; `definePayloadReducer`/`Reviver` for custom types.
- **Secrets in state**: tokens, internal ids or full user records in `useState` or other payload data → visible in page source. Fix: keep them server-side; send only what the UI needs.
- **Browser APIs during SSR**: `window`, `document`, `localStorage` in setup, plugins or composables → server crash or hydration mismatch. Fix: `onMounted`, `import.meta.client`, `.client.vue` or `<ClientOnly>`.
- **Nondeterministic render**: `Date.now()`, `Math.random()`, locale/timezone formatting or client-only state in templates → hydration mismatches. Fix: compute once on the server and reuse, or render after mount.
- **Removed global**: reading `window.__NUXT__` (removed after hydration in Nuxt 4) → `undefined`. Fix: `useNuxtApp().payload`.
- **Per-render side effects**: logging, counters or writes in setup run on the server and again on the client. Fix: `callOnce()` (3.9+) or `useAsyncData`.
