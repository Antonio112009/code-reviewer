---
name: App Router data fetching
description: Server Component data-fetching defects in Next.js — sequential awaits causing waterfalls, fetching your own Route Handlers from the server, undeduplicated ORM calls, memoization limits, conflicting fetch cache options and oversized generateStaticParams.
priority: 60
activation:
  content:
    - "\\bawait\\s+(?:fetch|db|prisma|sql)\\b"
    - "\\bfetch\\s*\\(\\s*[`'\"](?:https?://localhost|/api/)"
    - "\\b(?:generateStaticParams|generateMetadata)\\b"
    - "\\bcache\\s*\\(\\s*async\\b"
    - "\\bnext\\s*:\\s*\\{\\s*(?:revalidate|tags)\\b"
  examples:
    - "const posts = await prisma.post.findMany();"
    - "const data = await fetch('/api/posts').then(r => r.json());"
    - "export async function generateStaticParams() {"
    - "const getUser = cache(async (id) => db.user.findUnique({ where: { id } }));"
    - "const res = await fetch(url, { next: { revalidate: 60 } });"
sources:
  - https://nextjs.org/docs/app/getting-started/fetching-data
  - https://nextjs.org/docs/app/guides/caching-without-cache-components
  - https://nextjs.org/docs/14/app/building-your-application/caching
---
- **Waterfalls**: independent awaits in sequence (`await getUser(); await getPosts();`) or nested async components each awaiting before rendering children → latency adds up per request. Fix: start promises together with `Promise.all`, or stream parts with Suspense.
- **Fetching your own API**: Server Components calling `/api/...` Route Handlers → relative URLs fail on the server and absolute `localhost` calls add a hop and fail during `next build`. Fix: call the data function directly.
- **Undeduplicated queries**: only `GET` `fetch` calls are memoized per render (never inside Route Handlers); ORM or SDK calls repeated in `generateMetadata`, layouts and pages hit the DB each time. Fix: wrap them in a module-level React `cache()`.
- **Memoization opted out**: passing an `AbortController` `signal` to `fetch` disables request memoization → duplicate requests per render.
- **Conflicting fetch options**: `{ cache: 'no-store', next: { revalidate: 3600 } }` is invalid → both options are ignored (only a dev warning) and the default caching applies. Fix: pick one.
- **Huge generateStaticParams**: returning every product or post → very long builds and rate-limited sources during the build. Fix: prerender a popular subset and render the rest on demand.
