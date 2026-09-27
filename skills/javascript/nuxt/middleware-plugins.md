---
name: Route middleware, plugins and Nuxt context
description: Nuxt route middleware and plugin defects — unreturned navigateTo, redirect loops, server+client double runs, useRoute in middleware, page-only auth and route-rule gaps, composables after await.
priority: 64
activation:
  files: ["**/middleware/**/*.{ts,js}", "**/plugins/**/*.{ts,js}"]
  content:
    - "\\bdefineNuxt(?:RouteMiddleware|Plugin)\\s*\\("
    - "\\b(?:navigateTo|abortNavigation|addRouteMiddleware)\\s*\\("
    - "\\bappMiddleware\\b"
    - "\\bmiddleware\\s*:\\s*[\\['\"]"
    - "\\brunWithContext\\s*\\("
sources:
  - https://nuxt.com/docs/4.x/guide/directory-structure/app/middleware
  - https://nuxt.com/docs/4.x/guide/going-further/nuxt-app
  - https://github.com/nuxt/nuxt/security/advisories/GHSA-hxvh-4h3w-prp9
---
- **Unreturned navigation**: `navigateTo()`/`abortNavigation()` called without `return` in route middleware → navigation continues to the protected page. Fix: `return navigateTo('/login')`.
- **Redirect loop**: redirecting to `/login` without checking `to.path` → infinite redirects. Fix: skip when already on the target.
- **Double execution**: middleware for the initial page runs on the server and again on the client → duplicated side effects (analytics, token refresh, writes). Fix: guard with `import.meta.server`/`nuxtApp.isHydrating`; keep middleware idempotent.
- **useRoute in middleware**: reading `useRoute()` instead of the `to`/`from` arguments → the previous route's data. Fix: use `to`.
- **Page-only auth**: route middleware and `routeRules` `appMiddleware` gate pages, not `server/api`; rule keys with uppercase letters never matched in Nuxt 4.4.7–4.5.0 / 3.21.7–3.21.9 → auth bypass. Fix: authorize in server handlers; lowercase keys; upgrade.
- **Context lost after await**: `useNuxtApp()`, `useState`, `useRuntimeConfig` or other composables after an `await` in plugins/middleware → "Nuxt instance unavailable" or wrong request context. Fix: call before awaiting, or wrap in `nuxtApp.runWithContext()`.
