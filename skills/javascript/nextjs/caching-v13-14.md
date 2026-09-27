---
name: Next.js 13–14 caching
description: App Router caching defaults in Next.js 13–14 — fetch cached by default (POST and authorized requests included), static GET Route Handlers, a 30-second client Router Cache and request-time reads that make whole subtrees dynamic.
priority: 66
tags: [CWE-524]
activation:
  content:
    - "\\bfetch\\s*\\("
    - "\\bexport\\s+(?:async\\s+)?function\\s+GET\\b"
    - "\\b(?:revalidatePath|revalidateTag|cookies|headers)\\s*\\("
    - "\\brouter\\.refresh\\s*\\("
  versions: { framework.nextjs: "<15" }
sources:
  - https://nextjs.org/docs/14/app/building-your-application/caching
  - https://nextjs.org/docs/14/app/building-your-application/data-fetching/fetching-caching-and-revalidating
---
- **fetch cached by default**: server `fetch` without `cache: 'no-store'` or `next.revalidate` lands in the Data Cache, which persists across requests and deploys → stale data until revalidated; `POST` fetches are cached too (except inside POST Route Handlers).
- **Per-user fetch cached**: a `fetch` sending `Authorization`/`Cookie` headers is still cached unless an uncached request or a `cookies()`/`headers()` call precedes it → one user's data returned to others. Fix: `cache: 'no-store'` on personalized requests.
- **Static GET Route Handlers**: a `GET` handler that doesn't read the request, cookies or headers is rendered once at build → every caller gets build-time data. Fix: read request data or `export const dynamic = 'force-dynamic'`.
- **Router Cache staleness**: the client reuses visited dynamic pages for 30 s (static and prefetched ones for 5 min) → users see pre-mutation data. Fix: revalidate inside the Server Action or `router.refresh()`; revalidating in a Route Handler doesn't clear it.
- **Dynamic by accident**: one `cookies()`/`headers()` call or `no-store` fetch in a shared layout makes every route below it dynamic → latency and cost spikes. Fix: keep request-time reads in leaf components.
