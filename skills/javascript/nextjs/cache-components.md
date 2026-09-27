---
name: Cache Components ('use cache')
description: Cache Components defects with the use cache directive, cacheLife and cacheTag (Next.js 16, experimental in 15) — request data inside cached scopes, identity outside the cache key, cached exports callable from clients, build hangs, implicit lifetimes, per-instance caches and removed segment configs.
priority: 68
tags: [CWE-524, CWE-200]
activation:
  content:
    - "['\"]use cache(?::\\s*\\w+)?['\"]"
    - "\\b(?:cacheLife|cacheTag)\\s*\\("
    - "\\bcacheComponents\\s*:"
  versions: { framework.nextjs: ">=15" }
sources:
  - https://nextjs.org/docs/app/api-reference/directives/use-cache
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents
  - https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
  - https://nextjs.org/blog/july-2026-security-release
---
- **Request data in cached scopes**: `cookies()`, `headers()` or `searchParams` read inside `'use cache'`, directly or in a helper it calls → runtime error (may pass `next build` on dynamic routes). Fix: read outside, pass values as arguments.
- **Identity outside the key**: the key covers build, function, arguments and captured variables only; user data read from module state, globals or `React.cache` (isolated in cached scopes) isn't keyed → shared results. Fix: pass the user explicitly.
- **Cached exports as endpoints**: functions of a file-level `'use cache'` module can be imported into Client Components and called like Server Functions → client-controlled arguments. Fix: validate and authorize, or keep them server-only.
- **Runtime promises as props**: passing a `cookies()` promise or uncached data promise into a cached component → the build hangs and fails after about 50 s. Fix: await outside, pass plain values.
- **Implicit lifetime**: no `cacheLife()` → the `default` profile (client stale 5 min, revalidate 15 min, never expires) → older data than intended. Fix: explicit `cacheLife` plus `cacheTag` for invalidation.
- **Per-instance memory cache**: the default handler is an in-memory LRU; serverless instances rarely reuse entries and self-hosted replicas diverge. Fix: `'use cache: remote'` or `cacheHandlers` when sharing matters.
- **Removed segment configs**: with `cacheComponents` on, `dynamic`, `dynamicParams`, `revalidate` and `fetchCache` exports are removed and `runtime = 'edge'` is unsupported. Fix: migrate to `'use cache'`/`cacheLife`.
