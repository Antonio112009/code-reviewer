---
name: axum serving, middleware and sessions
description: axum::serve without timeouts, graceful-shutdown hangs, permissive tower-http CORS, IntoResponse leaking internals, cookie/session key handling and sensitive headers in TraceLayer.
priority: 63
tags: [CWE-400, CWE-942, CWE-209, CWE-384, CWE-532]
activation:
  content:
    - '\baxum::serve\b|\bwith_graceful_shutdown\b'
    - '\b(?:TimeoutLayer|RequestBodyTimeoutLayer|RequestBodyDeadlineLayer|RequestBodyLimitLayer|CorsLayer|TraceLayer)\b'
    - '\bimpl\s+IntoResponse\s+for\b'
    - '\b(?:Signed|Private)?CookieJar\b|\bKey::generate\(|\btower_sessions\b|\bcycle_id\('
  examples:
    - 'axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;'
    - 'let app = Router::new().layer(CorsLayer::very_permissive());'
    - 'impl IntoResponse for AppError {'
    - 'let jar: PrivateCookieJar = PrivateCookieJar::new(key);'
  versions: { framework.axum: '>=0.7' }
sources:
  - https://github.com/tokio-rs/axum/blob/main/axum/CHANGELOG.md
  - https://docs.rs/tower-http/latest/tower_http/cors/struct.CorsLayer.html
  - https://docs.rs/axum-extra/latest/axum_extra/extract/cookie/struct.PrivateCookieJar.html
  - https://docs.rs/tower-sessions/latest/tower_sessions/struct.Session.html#method.cycle_id
---
- **No server-side timeouts**: `axum::serve` (through 0.8.9) sets no header-read timeout or connection limit, and handlers have no deadline → slowloris and hung upstreams pin connections. Fix: `TimeoutLayer::with_status_code`, `RequestBodyDeadlineLayer` (tower-http 0.7), or a reverse proxy.
- **Graceful shutdown**: without `with_graceful_shutdown` deploys cut in-flight requests; with it, SSE, WebSocket or long-poll connections keep shutdown waiting until SIGKILL. Fix: trigger on SIGTERM and bound the drain with a timeout.
- **Permissive CORS**: `CorsLayer::very_permissive()` or `AllowOrigin::mirror_request()` with `allow_credentials(true)` lets any site read authenticated responses; credentials combined with `Any` panic when the layer is built. Fix: explicit origin list.
- **Leaky error responses**: `IntoResponse` impls rendering `err.to_string()` or `{:?}` of sqlx/anyhow/io errors send SQL, paths and internals to clients. Fix: log details, return generic bodies.
- **Cookies and sessions**: auth data in a plain `CookieJar` is client-editable; `Key::generate()` at startup logs everyone out on restart and differs per replica; logins without `session.cycle_id()` allow session fixation. Fix: `PrivateCookieJar`/`SignedCookieJar` with a configured key.
- **Secrets in traces**: `TraceLayer` spans that include headers log `Authorization` and cookies. Fix: `SetSensitiveRequestHeadersLayer` before `TraceLayer`.
