---
name: Service worker caching
description: Cache Storage defects in service workers — personalized responses cached across users and logouts, cache-first HTML pinning users to old builds, cached error and opaque responses, unbounded caches and non-GET requests intercepted.
priority: 60
tags: [CWE-524, CWE-400]
activation:
  content:
    - '\bcaches\.\w+\(|\bcache\.(?:put|add|addAll|match)\(|\brespondWith\('
    - '\b(?:CacheFirst|NetworkFirst|StaleWhileRevalidate|CacheOnly|registerRoute|precacheAndRoute|CacheableResponsePlugin|ExpirationPlugin)\b'
  examples:
    - 'event.respondWith(caches.match(event.request));'
    - 'precacheAndRoute(self.__WB_MANIFEST);'
sources:
  - https://developer.chrome.com/docs/workbox/caching-resources-during-runtime
  - https://developer.mozilla.org/en-US/docs/Web/API/Cache/put
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data
  - https://web.dev/articles/service-worker-lifecycle
---
- **Personalized responses cached**: caching API responses or HTML that depend on cookies/`Authorization` → served to another account or after logout (Cache Storage is per origin, not per user). Fix: skip authenticated routes or delete caches on logout (`Clear-Site-Data`).
- **Cache-first HTML**: navigations served cache-first or from an unversioned app shell → users stuck on old HTML referencing deleted hashed chunks (chunk-load errors after deploys). Fix: network-first for navigations; precache with revisions.
- **Cached failures**: `cache.put` stores whatever it gets (unlike `add`/`addAll`); storing responses without checking `response.ok`, or caching opaque (status 0) responses cache-first → persistently broken pages or images. Fix: cache only 200s (`CacheableResponsePlugin`), network-first/SWR for opaque.
- **Opaque quota bloat**: caching cross-origin `no-cors` responses → each counts roughly 7 MB against Chrome's quota → quota errors and eviction. Fix: request with CORS (`crossorigin`) or don't cache them.
- **Unbounded caches**: runtime caches without `maxEntries`/`maxAgeSeconds` and old versioned caches never deleted in `activate` → storage grows until eviction. Fix: expiration and cleanup.
- **Non-GET interception**: `respondWith` for POST/PUT, uploads or media range requests, or `cache.put` of non-GET requests (rejected) → broken writes and video seeking. Fix: handle only GET; let others pass through.
