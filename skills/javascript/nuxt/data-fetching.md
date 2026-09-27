---
name: Data fetching
description: useFetch, useAsyncData and $fetch misuse in Nuxt 3/4 — double fetching, calls outside setup, key collisions, non-reactive params, Nuxt 4 shallow/undefined data, payload bloat and lost cookies during SSR.
priority: 66
activation:
  content:
    - "\\buse(?:Lazy)?(?:Fetch|AsyncData)\\s*[(<]"
    - "\\$fetch\\s*[(<.]"
    - "\\b(?:refreshNuxtData|clearNuxtData|useRequestFetch|useNuxtData)\\s*\\("
sources:
  - https://nuxt.com/docs/4.x/getting-started/data-fetching
  - https://nuxt.com/docs/4.x/api/composables/use-async-data
  - https://nuxt.com/docs/4.x/getting-started/upgrade
  - https://nuxt.com/docs/4.x/api/utils/dollarfetch
---
- **Bare $fetch in setup**: `await $fetch()` in component setup → runs on the server and again during hydration. Fix: `useFetch` or `useAsyncData(key, () => $fetch(…))`.
- **Composable outside setup**: `useFetch`/`useAsyncData` in click handlers, watchers or after `await` in a plain function → no Nuxt context ("Nuxt instance unavailable"). Fix: `$fetch` for user-triggered requests.
- **Key collision**: one explicit key for different requests (`'user'` for all ids) → Nuxt 4 shares `data`/`error`/`status` per key; callers see another request's data. Fix: a key per resource (`'user-' + id`).
- **Non-reactive params**: `query: { page: page.value }` or a URL built from `id.value` → captured once, never refetches. Fix: pass refs or getters. A reactive POST `body` re-sends on every change → `watch: false`.
- **Nuxt 4 data shape**: `data` is a `shallowRef` (`deep: false`) starting as `undefined` (Nuxt 3: `null`) → nested mutations don't re-render; `=== null` checks break. Fix: replace `data.value`, `deep: true`, check `status`.
- **Payload bloat/leak**: trimming whole records with `pick`/`transform` → the server still fetches everything and kept fields land in the HTML payload. Fix: select fields in the API route.
- **Lost cookies on server**: `$fetch('/api/…')` during SSR doesn't forward the visitor's cookies → anonymous responses. Fix: `useFetch` or `useRequestFetch()`.
