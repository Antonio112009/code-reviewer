---
name: chi routing and middleware
description: chi RealIP spoofing (deprecated in v5.3.0), With() results ignored, Timeout that does not interrupt handlers, Recoverer placement, RawPath-based URL params, RedirectSlashes open redirect and global Throttle.
priority: 64
tags: [CWE-348, CWE-284, CWE-601]
activation:
  content:
    - '\bmiddleware\.(?:RealIP|ClientIP\w{0,25}|GetClientIP|Timeout|Recoverer|RedirectSlashes|StripSlashes|Throttle\w{0,10})\b'
    - '\.(?:With|Group|Route|Mount|Use)\('
    - '\bchi\.URLParam\w{0,10}\('
sources:
  - https://pkg.go.dev/github.com/go-chi/chi/v5/middleware
  - https://github.com/advisories/GHSA-9g5q-2w5x-hmxf
  - https://github.com/go-chi/chi/security/advisories/GHSA-mqqf-5wvp-8fh8
  - https://github.com/go-chi/chi/blob/master/mux.go
---
- **RealIP spoofing**: `middleware.RealIP` overwrites `r.RemoteAddr` with the leftmost `X-Forwarded-For`/`X-Real-IP`/`True-Client-IP` → clients choose their IP for rate limits, allowlists and logs; deprecated in v5.3.0. Fix: `ClientIPFromXFF(trusted CIDRs)`/`ClientIPFromHeader` + `GetClientIP`.
- **With() result ignored**: `r.With(auth)` returns a new inline router; calling it without chaining (`r.With(auth); r.Get(…)`) leaves routes unprotected, and middleware inside `r.Group`/`r.Route` doesn't cover parent routes. Fix: `r.With(auth).Get(…)`.
- **Timeout doesn't interrupt**: `middleware.Timeout` only cancels the context and writes 504 after the handler returns → handlers ignoring `ctx.Done()` keep running and may write twice. Fix: ctx-aware handlers.
- **Recoverer first**: `middleware.Recoverer` must be the outermost middleware or panics in earlier middleware escape; panics in goroutines still crash.
- **Escaped URL params**: chi routes on `r.URL.RawPath` when present, so `chi.URLParam` returns still-escaped values for paths with encoded slashes and decoded values otherwise → inconsistent validation. Fix: `url.PathUnescape`, then validate.
- **RedirectSlashes**: open redirect via `/\evil.com` before v5.2.4 (Host-header variant before v5.2.2). Fix: upgrade.
- **Throttle is global**: `middleware.Throttle(n)` caps concurrent requests across all clients, not per client → one client starves others. Fix: per-key rate limiting.
