---
name: actix-web middleware, CORS and sessions
description: actix-web middleware ordering, Route::wrap before .to() silently dropping middleware (before 4.14) or panicking (4.14+), scope coverage, permissive actix-cors and actix-session login/logout handling.
priority: 64
tags: [CWE-862, CWE-942, CWE-384, CWE-613]
activation:
  content:
    - '\.wrap(?:_fn)?\('
    - '\bfrom_fn\(|\bTransform\b|\bServiceRequest\b'
    - '\bCors::'
    - '\bSession\b|\.renew\(\)|\.purge\(\)|\b(?:Cookie|Redis)SessionStore\b|\bIdentity\b'
sources:
  - https://actix.rs/docs/middleware
  - https://github.com/actix/actix-web/issues/3756
  - https://docs.rs/actix-cors/latest/actix_cors/struct.Cors.html
  - https://docs.rs/actix-session/latest/actix_session/struct.Session.html
---
- **Registration order**: with several `.wrap()`/`.wrap_fn()` calls the last registered runs first (outermost) → auth after logging or rate limiting, CORS headers missing on auth errors. Fix: order deliberately; test the chain.
- **`Route::wrap` before `.to()`**: `web::post().wrap(auth).to(handler)` silently dropped the middleware before actix-web 4.14 (unauthenticated handler) and panics at startup since 4.14. Fix: `.to(handler).wrap(auth)`, or wrap the resource or scope.
- **Scope coverage**: `wrap` on a `scope`/`resource` covers only that scope; routes registered on `App`, other scopes or `default_service` stay unprotected. Fix: wrap at the level that covers every protected route.
- **Permissive CORS**: `Cors::permissive()` (any origin, credentials supported) or `allow_any_origin()` with `supports_credentials()` echoes any `Origin` → any site can read authenticated responses. Fix: `allowed_origin(..)` list.
- **Session lifecycle**: no `session.renew()` after login (fixation) and no `session.purge()` on logout; `CookieSessionStore` keeps all state in the cookie, so logout cannot revoke stolen copies. Fix: renew/purge; server-side store for revocable sessions.
