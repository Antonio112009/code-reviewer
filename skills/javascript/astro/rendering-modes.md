---
name: Prerendering vs on-demand rendering
description: Astro rendering-mode defects — request-dependent pages and endpoints prerendered at build time, non-GET static endpoints, response headers set from components, and route caching (Astro 7) or CDN headers on personalized output.
priority: 66
activation:
  files: ["**/src/pages/**/*.{astro,ts,js}"]
  content:
    - "\\bexport\\s+const\\s+prerender\\b"
    - "\\boutput\\s*:\\s*['\"](?:server|static)['\"]"
    - "\\bAstro\\.(?:request|cookies|session|response|cache)\\b"
    - "\\bAstro\\.url\\.searchParams\\b"
    - "\\bcontext\\.cache\\b|\\brouteRules\\b"
    - "\\bexport\\s+(?:const|async\\s+function|function)\\s+(?:GET|POST|PUT|PATCH|DELETE|ALL)\\b"
sources:
  - https://docs.astro.build/en/guides/on-demand-rendering/
  - https://docs.astro.build/en/guides/endpoints/
  - https://docs.astro.build/en/guides/caching/
  - https://docs.astro.build/en/reference/configuration-reference/
---
- **Prerendered request logic**: with the default `static` output, pages/endpoints reading cookies, headers, `Astro.url.searchParams` or the session render once at build → everyone gets build-time values; per-request auth never runs. Fix: `export const prerender = false` or `output: 'server'`.
- **Static endpoints**: prerendered endpoints only run `GET` at build time → `POST`/`PUT`/`DELETE` handlers that work in dev are not served in production. Fix: `prerender = false` for endpoints with side effects.
- **Headers from components**: setting `Astro.response` headers/status or cookies in layouts or child components → ignored; response headers can only be set at page level. Fix: set them in the page or middleware.
- **Cached personal output (7.x)**: `Astro.cache.set()`, `routeRules` `maxAge`/`swr`, or CDN `Cache-Control` on responses that depend on cookies or the session → one user's page served to others. Fix: `cache.set(false)`/`private, no-store` on personalized routes.
- **Stale cache after writes**: cached routes without tags or `invalidate()` after mutations → stale content until `maxAge`; path invalidation matches exact paths only. Fix: tag entries; invalidate by tag.
