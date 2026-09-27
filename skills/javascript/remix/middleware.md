---
name: React Router middleware
description: React Router middleware defects (7.9+ behind future.v8_middleware, always on in v8) — auth middleware skipped on client navigations, next() misuse, getLoadContext not returning RouterContextProvider, request-shared context and client middleware used as security.
priority: 66
tags: [CWE-862, CWE-200]
activation:
  content:
    - "\\b(?:middleware|clientMiddleware)\\s*[:=]"
    - "\\bRouterContextProvider\\b"
    - "\\bcontext\\.(?:get|set)\\s*\\("
    - "\\bv8_middleware\\b"
    - "\\b(?:getLoadContext|AppLoadContext)\\b"
  versions: { framework.remix: ">=7.9" }
sources:
  - https://reactrouter.com/how-to/middleware
  - https://reactrouter.com/changelog
---
- **Skipped on client navigations**: server middleware runs only for document and `.data` requests, so client navigations to routes without a `loader`/`action` never reach it → auth or audit middleware silently skipped. Fix: add a loader, or enforce in loaders.
- **Dropped response**: server middleware that awaits `next()` without returning its `Response`, or calls `next()` twice → broken responses or thrown errors. Fix: `return next()` exactly once.
- **Wrong load context**: with middleware enabled (always in v8, where `AppLoadContext` is gone), `getLoadContext` must return a `RouterContextProvider`; `context.db`-style property reads break. Fix: `createContext()` keys with `context.get/set`.
- **Shared context instances**: a `RouterContextProvider` or context value created at module scope and reused by `getLoadContext` → one request's user leaks into another. Fix: create per request.
- **Client middleware as security**: `clientMiddleware` redirects are UX only; the server still answers direct document and `.data` requests. Fix: enforce on the server.
