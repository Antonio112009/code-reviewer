---
name: Page lifecycle and bfcache
description: Page-lifecycle defects — unload handlers (blocking bfcache and, with Chrome's 2026 unload deprecation, no longer firing), unconditional beforeunload, no-store HTML, stale state after back/forward restores, open connections and data saved only on unload.
priority: 50
activation:
  content:
    - '[''"](?:unload|beforeunload|pagehide|pageshow|visibilitychange|freeze)[''"]'
    - '\bon(?:unload|beforeunload)\b|\bsendBeacon\(|\bkeepalive\s*:'
    - '\bCache-Control\b[^\n]{0,60}\bno-store\b'
sources:
  - https://web.dev/articles/bfcache
  - https://developer.chrome.com/docs/web-platform/deprecating-unload
  - https://developer.chrome.com/docs/web-platform/page-lifecycle-api
---
- **`unload` handlers**: analytics, saving or cleanup in `unload` → blocks the back/forward cache (desktop Chrome/Firefox), and Chrome's unload deprecation (all sites, 1% → 100% during 2026, Chrome 146–154) stops firing it. Fix: `pagehide`/`visibilitychange` with `navigator.sendBeacon` or `fetch(…, { keepalive: true })`.
- **Unconditional `beforeunload`**: listener registered for the whole page lifetime → bfcache ineligibility in some browsers, needless prompts. Fix: add it only while there are unsaved changes; remove after saving.
- **`no-store` on ordinary pages**: `Cache-Control: no-store` on non-sensitive HTML → excluded from bfcache: slower back/forward navigations. Fix: `no-cache`/`max-age=0` unless the content is sensitive.
- **Stale restored pages**: no `pageshow` handler checking `event.persisted` → after back/forward, pages show stale carts, counters or a previous user's data after logout. Fix: refresh state on restore.
- **Open connections**: WebSockets, IndexedDB transactions or in-flight requests left open on `pagehide` → page not cached in some browsers. Fix: close on `pagehide`, reconnect on `pageshow`.
- **Data saved only at exit**: drafts or analytics sent only from `beforeunload`/`unload` → lost when mobile browsers kill background tabs. Fix: persist when `visibilityState` becomes `hidden`.
