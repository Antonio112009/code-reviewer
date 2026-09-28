---
name: Service worker lifecycle and updates
description: Service worker update defects — unconditional skipWaiting mixing versions, users stuck on waiting workers, controllerchange reload loops, wrong registration scope, stale importScripts and no way to retire a broken worker.
priority: 58
tags: [CWE-494]
activation:
  content:
    - '\bskipWaiting\(|\bclients\.claim\(|\bcontrollerchange\b'
    - '\bserviceWorker\.register\(|\bregistration\.(?:update|waiting|installing)\b|\bupdateViaCache\b'
    - '\bimportScripts\(|Service-Worker-Allowed|\bunregister\('
  examples:
    - 'self.skipWaiting();'
    - "navigator.serviceWorker.register('/sw.js', { scope: '/' });"
    - "importScripts('/workbox-sw.js');"
sources:
  - https://web.dev/articles/service-worker-lifecycle
  - https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
  - https://developer.chrome.com/docs/workbox/handling-service-worker-updates
---
- **Unconditional `skipWaiting()`**: activating a new worker while pages from the old build are open → old pages are served by new caches and routes (missing chunks, API mismatches). Fix: prompt to reload, or `skipWaiting` only on user action and reload once.
- **Stuck in waiting**: no update UI → the new worker activates only after every tab closes (a reload isn't enough) → users run stale code for days. Fix: detect `registration.waiting`, offer an update that messages it to skip waiting.
- **Reload loops**: `controllerchange` → `location.reload()` without a guard → repeated reloads. Fix: a once-only flag.
- **Wrong scope**: registering `/static/js/sw.js` → scope limited to `/static/js/`, pages never controlled (unless `Service-Worker-Allowed`); registering from user-upload or JSONP paths lets attackers persist a worker. Fix: serve the worker from the root; never from user-controlled paths.
- **Stale imports**: `importScripts()`/imported modules with long `Cache-Control` → the default `updateViaCache: 'imports'` serves old copies from HTTP cache. Fix: hashed import URLs or `updateViaCache: 'none'`.
- **No kill switch**: deleting `sw.js` (404) keeps the old worker active and its caches in use → a broken worker can't be removed. Fix: ship a replacement worker that clears caches and calls `self.registration.unregister()`.
