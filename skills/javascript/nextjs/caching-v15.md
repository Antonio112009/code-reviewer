---
name: Next.js 15+ caching (previous model)
description: App Router caching in Next.js 15–16 without Cache Components — build-time frozen pages despite uncached fetch, GET handlers now dynamic, layouts still reused from the client cache, router.refresh vs revalidation and revalidateTag profiles vs updateTag.
priority: 66
tags: [CWE-524]
activation:
  content:
    - "\\bfetch\\s*\\("
    - "\\bexport\\s+(?:async\\s+)?function\\s+GET\\b"
    - "\\b(?:revalidatePath|revalidateTag|updateTag|connection)\\s*\\("
    - "\\b(?:staleTimes|router\\.refresh)\\b"
  versions: { framework.nextjs: ">=15" }
sources:
  - https://nextjs.org/docs/app/guides/caching-without-cache-components
  - https://nextjs.org/docs/app/guides/upgrading/version-15
  - https://nextjs.org/docs/app/guides/upgrading/version-16
  - https://nextjs.org/docs/app/api-reference/functions/updateTag
---
- **Build-time frozen pages**: `fetch` is uncached by default, yet a route with no request-time API is still prerendered, so data fetched before any `cookies()`/`headers()`/`connection()` is frozen until the next build. Fix: `await connection()` for per-request pages, `revalidate` for periodic ones.
- **GET handlers now dynamic**: since 15 `GET` Route Handlers run per request → code that relied on 14's build-time caching now hits the origin every call (cost, rate limits). Fix: `dynamic = 'force-static'` or `revalidate` where data is public.
- **Stale layouts**: page segments are no longer reused from the client Router Cache (`staleTimes.dynamic` = 0), but layouts and loading states still are → layout data (nav badges, user menu) stays stale after mutations. Fix: revalidate in the action.
- **router.refresh is not revalidation**: `router.refresh()` re-renders from the server but keeps Data Cache and `unstable_cache` entries → still stale. Fix: `revalidatePath`, `revalidateTag` or `updateTag`.
- **revalidateTag profiles (16)**: `revalidateTag(tag)` without a profile is deprecated; `revalidateTag(tag, 'max')` serves stale data while refreshing, so the user who just saved sees old data. Fix: `updateTag(tag)` in Server Actions for read-your-writes.
