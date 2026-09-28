---
name: Route segment config and static rendering
description: Route segment config exports and static-rendering traps — force-static emptying request data, non-literal values, lowest revalidate winning, dynamicParams 404s, side effects and after() running at build time, and the deprecated edge runtime.
priority: 62
activation:
  content:
    - "\\bexport\\s+const\\s+(?:dynamic|revalidate|fetchCache|dynamicParams|runtime|maxDuration)\\s*="
    - "\\bgenerateStaticParams\\b"
    - "\\bafter\\s*\\("
  examples:
    - "export const dynamic = 'force-static';"
    - "export async function generateStaticParams() {"
    - "after(() => logAnalytics(event));"
sources:
  - https://nextjs.org/docs/app/guides/caching-without-cache-components
  - https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
  - https://nextjs.org/docs/app/api-reference/functions/after
  - https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/runtime
---
- **force-static empties request data**: `dynamic = 'force-static'` makes `cookies()`, `headers()` and `useSearchParams()` return empty values → auth or personalization silently takes the anonymous path, and that output is cached for everyone.
- **Non-literal values**: `revalidate = 60 * 10`, imported constants or computed `dynamic` values are not statically analyzable → invalid config. Fix: literal values.
- **Lowest revalidate wins**: the smallest `revalidate` among a route's layouts, pages and fetches sets the whole route's frequency → `revalidate = 1` in a shared layout re-renders every child each second.
- **dynamicParams = false**: only params returned by `generateStaticParams` exist → new products or posts 404 until the next build.
- **Build-time side effects**: code in statically rendered routes — logging, counters, `after()` callbacks — runs at build or revalidation, not per request → analytics and audit trails silently missing. Fix: make the route dynamic.
- **Edge runtime**: `runtime = 'edge'` (deprecated) lacks Node APIs (`fs`, most of `crypto`, native modules) and segment `revalidate` → runtime crashes or ignored config. Fix: the default `nodejs` runtime.
