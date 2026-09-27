---
name: Next.js on-demand revalidation
description: revalidatePath / revalidateTag / updateTag / unstable_cache defects — dynamic patterns without type, rewritten URLs, path versus tag scope, unprotected revalidation endpoints, updateTag outside actions and cache keys missing closure values.
priority: 64
tags: [CWE-306]
activation:
  content:
    - "\\b(?:revalidatePath|revalidateTag|updateTag|unstable_cache)\\s*\\("
    - "\\bres\\.revalidate\\s*\\("
sources:
  - https://nextjs.org/docs/app/api-reference/functions/revalidatePath
  - https://nextjs.org/docs/app/api-reference/functions/updateTag
  - https://nextjs.org/docs/app/api-reference/functions/unstable_cache
---
- **Pattern without type**: `revalidatePath('/blog/[slug]')` needs `'page'` or `'layout'`; a literal path refreshes only that page, and `revalidatePath('/')` only the home page (`('/', 'layout')` purges all) → other affected pages stay stale.
- **Rewritten URLs**: behind `rewrites()`, revalidating the public source path matches nothing. Fix: pass the destination route path.
- **Path vs tag scope**: `revalidatePath('/blog')` refreshes that route only; other pages reading the same data stay stale. Fix: tag shared data (`next: { tags }`, `cacheTag`) and revalidate the tag.
- **Unprotected revalidation endpoints**: a Route Handler or API route calling `revalidatePath`, `revalidateTag` or `res.revalidate` from query params without a secret or signature → anyone can flush caches (origin load, cost). Fix: verify a secret; allowlist paths/tags.
- **updateTag outside actions**: `updateTag` throws outside Server Actions, e.g. in webhook Route Handlers. Fix: `revalidateTag(tag, 'max')` there.
- **unstable_cache keys**: variables captured by the cached function are not in the key unless listed in `keyParts` → results shared across users or entities; `cookies()`/`headers()` inside are unsupported. Fix: pass inputs as arguments.
