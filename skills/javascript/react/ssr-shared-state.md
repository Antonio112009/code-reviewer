---
name: Cross-request state in SSR
description: Server-rendered React (Next.js, Remix / React Router, Astro) leaking per-user state across requests through module-level data clients, stores, global request configuration or unscoped memoizers.
priority: 70
tags: [CWE-200, CWE-362]
activation:
  stack: [framework.nextjs, framework.remix, framework.astro]
  content:
    - "\\bnew\\s+(?:QueryClient|ApolloClient)\\s*\\("
    - "\\b(?:createStore|configureStore|createWithEqualityFn)\\s*\\("
    - "\\bcreate(?:<[^>\\n]{1,80}>)?\\s*\\(\\s*\\(\\s*set\\b"
    - "\\bcreate<[^>\\n]{1,80}>\\s*\\(\\s*\\)\\s*\\("
    - "\\baxios\\.defaults\\.headers\\b"
    - "\\bi18n(?:ext)?\\.changeLanguage\\s*\\("
sources:
  - https://tanstack.com/query/latest/docs/framework/react/guides/ssr
  - https://redux.js.org/usage/nextjs
  - https://zustand.docs.pmnd.rs/learn/guides/nextjs
---
- **Module-level data clients**: `const queryClient = new QueryClient()` (or an Apollo/urql client) at module scope used during SSR → one cache for all requests: user A's data rendered for user B. Fix: create per request, e.g. `useState(() => new QueryClient())`.
- **Module-level stores**: Redux, Zustand or Jotai stores created once and filled with user data on the server → cross-user leaks and state carried between requests. Fix: create the store per request inside a provider.
- **Global request config**: server code setting `axios.defaults.headers.common.Authorization`, a global current user/tenant, or `i18n.changeLanguage()` on a shared instance → concurrent requests overwrite each other (wrong token or language). Fix: per-request instances or `AsyncLocalStorage`.
- **Unscoped memoizers**: module-level `Map`/LRU caches of personalized results keyed without user or tenant → data served to the wrong user. Fix: include the identity in the key, or use request-scoped React `cache()`.
