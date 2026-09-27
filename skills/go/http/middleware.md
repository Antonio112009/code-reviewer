---
name: net/http middleware and ResponseWriter wrappers
description: Wrappers that hide Flusher/Hijacker, headers set after next.ServeHTTP, recovery middleware limits, middleware skipped for some routes and Go 1.25 CrossOriginProtection gaps.
priority: 60
tags: [CWE-352, CWE-284]
activation:
  content:
    - '\bnext\.ServeHTTP\('
    - '\bfunc\s*\(\s*\w{1,20}\s+http\.Handler\s*\)\s*http\.Handler\b'
    - '\bhttp\.(?:CrossOriginProtection|NewCrossOriginProtection|NewResponseController|ErrAbortHandler|Flusher|Hijacker)\b'
    - '^[ \t]*http\.ResponseWriter[ \t]*$'
    - '\bUnwrap\(\)\s*http\.ResponseWriter\b'
sources:
  - https://pkg.go.dev/net/http#NewResponseController
  - https://pkg.go.dev/net/http#CrossOriginProtection
  - https://pkg.go.dev/net/http#ErrAbortHandler
  - https://go.dev/doc/go1.25
---
- **Wrappers hide interfaces**: status/size recorders or gzip writers embedding `http.ResponseWriter` without `Unwrap()` lose `Flusher`, `Hijacker` and `ReaderFrom` → SSE never flushes, websocket upgrades fail, `ResponseController` deadlines return `ErrNotSupported`. Fix: add `Unwrap() http.ResponseWriter` (Go 1.20+).
- **Headers after next**: security headers, cookies or `WriteHeader` set after `next.ServeHTTP` returns are dropped once the handler wrote → protection only on empty responses. Fix: set them before calling next, or in a `WriteHeader` hook.
- **Recovery limits**: recover middleware cannot catch panics in goroutines, should re-panic `http.ErrAbortHandler`, and writing a 500 after the handler already wrote corrupts the response. Fix: track whether headers were sent.
- **Unwrapped routes**: auth applied per route (`mux.Handle(p, auth(h))`) misses routes added later or mounted sub-muxes, and middleware on a sub-mux doesn't cover the parent → unauthenticated endpoints. Fix: wrap the root handler; deny by default.
- **CrossOriginProtection (Go 1.25+)**: only non-safe methods are checked (GET/HEAD/OPTIONS always pass) and requests lacking `Sec-Fetch-Site`/`Origin` are allowed → state-changing GETs stay exposed; broad `AddInsecureBypassPattern` disables it. Fix: no side effects on GET, narrow bypasses.
