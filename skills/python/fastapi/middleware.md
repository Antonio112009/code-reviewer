---
name: Middleware, CORS and proxies
description: FastAPI/Starlette middleware defects — credentialed wildcard CORS that reflects any origin, loose origin regexes, middleware ordering, BaseHTTPMiddleware limitations, missing Host validation and over-trusted forwarded headers.
priority: 68
tags: [CWE-942, CWE-346, CWE-348, A02:2025]
activation:
  content:
    - '\b(?:CORSMiddleware|TrustedHostMiddleware|HTTPSRedirectMiddleware|GZipMiddleware|BaseHTTPMiddleware|ProxyHeadersMiddleware|SessionMiddleware)\b'
    - '\badd_middleware\(|@\w+\.middleware\(|\bMiddleware\('
    - '\ballow_(?:origins|origin_regex|credentials)\s*='
    - '--forwarded-allow-ips|\bforwarded_allow_ips\b|\bproxy_headers\b'
  examples:
    - 'app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True)'
    - '@app.middleware("http")'
    - 'uvicorn.run(app, forwarded_allow_ips="*")'
sources:
  - https://fastapi.tiangolo.com/tutorial/cors/
  - https://starlette.dev/middleware/
  - https://github.com/encode/starlette/blob/main/starlette/middleware/cors.py
  - https://uvicorn.dev/settings/
---
- **Credentialed wildcard CORS**: `CORSMiddleware(allow_origins=["*"], allow_credentials=True)` echoes the caller's `Origin` with `Access-Control-Allow-Credentials: true` → any site reads authenticated responses. Fix: explicit origins.
- **Loose origin regex**: `allow_origin_regex` with unescaped dots or a broad wildcard (`https://.*example.com`) matches attacker domains such as `evilexample.com`.
- **Middleware order**: the last `add_middleware()` call is the outermost layer; CORS added before other middleware that returns early (auth, rate limits) leaves those error responses without CORS headers → browser clients see opaque failures.
- **BaseHTTPMiddleware limits**: `@app.middleware("http")`/`BaseHTTPMiddleware` stops `ContextVar` changes from propagating upward (request ids, tracing), and before Starlette 1.7 started background tasks before the last body chunk was sent. Fix: pure ASGI middleware.
- **No Host validation**: without `TrustedHostMiddleware`, `request.url_for()` and absolute links built from the `Host` header can be poisoned (password-reset links, redirects).
- **Forwarded headers over-trusted**: uvicorn `--forwarded-allow-ips="*"` (or `FORWARDED_ALLOW_IPS=*`) on a directly reachable app lets clients spoof `request.client.host` and scheme → broken IP allowlists and rate limits. Fix: list only proxy IPs.
- **Streaming behind GZip (Starlette <1.5)**: `GZipMiddleware` buffered streamed chunks, stalling SSE and progressive responses. Fix: upgrade or exclude those routes.
