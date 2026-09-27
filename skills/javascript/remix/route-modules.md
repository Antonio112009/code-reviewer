---
name: Route modules (Remix / React Router)
description: Route module defects — module-scope secrets and server imports shipped to the client, meta arrays replaced by child routes, headers taken from the deepest route only, sanitized production errors, clientLoader.hydrate without HydrateFallback and meta JSON-LD XSS before 7.9.
priority: 62
tags: [CWE-200, CWE-79]
activation:
  content:
    - "\\bexport\\s+(?:const|(?:async\\s+)?function)\\s+(?:meta|links|headers|handle|shouldRevalidate|ErrorBoundary|HydrateFallback)\\b"
    - "\\bclientLoader\\.hydrate\\b"
    - "\\.server['\"]"
    - "\\bisRouteErrorResponse\\b"
sources:
  - https://reactrouter.com/start/framework/route-module
  - https://reactrouter.com/api/framework-conventions/server-modules
  - https://github.com/remix-run/react-router/security/advisories/GHSA-3cgp-3xvw-98x8
---
- **Module-scope secrets**: only `loader`/`action` bodies are stripped from client bundles; top-level code and imports of a route module (API keys, DB clients) ship to the browser. Fix: move them into `*.server.ts` files or `.server/` folders.
- **meta replaced, not merged**: a child route's `meta` replaces the parent's whole array → lost description, canonical or OG tags. Fix: merge from `matches` explicitly, or render React 19 `<title>`/`<meta>`.
- **headers from one route**: only the deepest route exporting `headers` is used; parent `Cache-Control` is ignored unless merged via `parentHeaders` → wrong caching.
- **Error details**: in production, errors thrown by loaders or actions reach `ErrorBoundary` sanitized → UI branching on `error.message` breaks. Fix: throw `data(…, { status })` and check `isRouteErrorResponse`.
- **hydrate without HydrateFallback**: `clientLoader.hydrate = true` without a `HydrateFallback` export → nothing useful renders until the client loader finishes on first load. Fix: export `HydrateFallback`.
- **meta JSON-LD XSS**: `meta` returning `script:ld+json` with user content → XSS before React Router 7.9.0. Fix: upgrade; keep user data out of unescaped meta.
