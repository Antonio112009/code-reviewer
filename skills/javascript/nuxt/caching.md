---
name: Caching and route rules
description: Cross-user leaks and stale data from Nuxt routeRules (swr, isr, cache), Nitro cached handlers/functions and runtime payload extraction.
category: security
priority: 70
tags: [CWE-524, CWE-200]
activation:
  content:
    - "\\bdefineCached(?:EventHandler|Function)\\b"
    - "\\bcached(?:EventHandler|Function)\\s*\\("
    - "\\brouteRules\\b"
    - "\\b(?:swr|isr)\\s*:"
    - "\\bpayloadExtraction\\b"
    - "\\bshouldBypassCache\\b"
  examples:
    - 'export default defineCachedEventHandler(async (event) => getPosts(), { maxAge: 60 });'
    - 'const getUser = cachedFunction(fetchUser, { maxAge: 60 });'
    - 'routeRules: { ''/blog/**'': { swr: 3600 } },'
    - 'experimental: { payloadExtraction: false },'
    - 'shouldBypassCache: (event) => !!event.node.req.headers.authorization,'
sources:
  - https://v2.nitro.build/guide/cache
  - https://nuxt.com/docs/4.x/guide/concepts/rendering
  - https://github.com/nuxt/nuxt/security/advisories/GHSA-wm8w-6qjm-cv43
---
- **Cached personalized routes**: `swr`/`isr`/`cache` route rules on pages or APIs whose output depends on cookies or the session → one user's HTML/JSON served to others. Fix: cache public routes only; `cache: false` for private ones.
- **Payload cache leak (Nuxt 4.4.0–4.5.0)**: cached routes also store `/_payload.json` under a path-only key → authenticated SSR data readable by anyone. Fix: upgrade to ≥4.5.1 or set `experimental.payloadExtraction: false`; purge caches.
- **Headers dropped**: Nitro cached handlers drop request headers not listed in `varies` → auth checks inside see no cookie/`Authorization` (always anonymous, or a wrong tenant). Fix: authorize outside the cached function; `varies` only for non-secret headers like host.
- **Key without identity**: `defineCachedFunction`/`defineCachedEventHandler` whose `getKey` omits user, tenant or locale → cross-user responses. Fix: include every input that changes the output.
- **Defaults**: `maxAge` defaults to 1 second and `swr` serves stale entries while revalidating → caching that barely works, or stale reads after writes. Fix: explicit `maxAge`; invalidate after mutations.
