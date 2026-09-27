---
name: http.Server timeouts, body limits and shutdown
description: Servers without header/read/idle timeouts, WriteTimeout killing streams, unbounded request bodies, TimeoutHandler side effects and graceful-shutdown mistakes (ErrServerClosed, hijacked connections).
priority: 64
tags: [CWE-400, CWE-770]
activation:
  content:
    - '\bhttp\.(?:ListenAndServe\w{0,3}|Serve\w{0,3}|Server|MaxBytesReader|MaxBytesHandler|TimeoutHandler|ErrServerClosed)\b'
    - '\.(?:ListenAndServe\w{0,3}|Shutdown|RegisterOnShutdown|SetWriteDeadline|SetReadDeadline)\('
    - '\b(?:ReadHeader|Read|Write|Idle)Timeout\b'
    - '\b(?:ParseMultipartForm|MaxMultipartMemory)\b'
    - '\bsignal\.Notify(?:Context)?\('
sources:
  - https://pkg.go.dev/net/http#Server
  - https://pkg.go.dev/net/http#Server.Shutdown
  - https://pkg.go.dev/net/http#MaxBytesReader
  - https://pkg.go.dev/net/http#ResponseController
---
- **No timeouts**: `http.ListenAndServe(addr, h)` or `http.Server{}` without `ReadHeaderTimeout`/`ReadTimeout` → slowloris clients hold connections and memory; `IdleTimeout` falls back to `ReadTimeout`, else unlimited. Fix: explicit `http.Server` with all three.
- **WriteTimeout vs streaming**: a global `WriteTimeout` cuts SSE, long downloads and websockets mid-stream. Fix: per-request deadlines via `http.NewResponseController(w).SetWriteDeadline` (Go 1.20+).
- **Unbounded bodies**: decoding `r.Body` without `http.MaxBytesReader`/`MaxBytesHandler` → memory DoS (only urlencoded `ParseForm` caps at 10 MB); `ParseMultipartForm(n)` spills the rest to disk, it is not a size limit. Fix: MaxBytesReader, 413 on `*http.MaxBytesError`.
- **TimeoutHandler**: buffers the whole response, drops `Flusher`/`Hijacker` and lets the handler keep running after the 503. Fix: ctx-aware handlers and server timeouts.
- **Shutdown flow**: after `Shutdown`, `ListenAndServe` returns `http.ErrServerClosed` at once — `log.Fatal(srv.ListenAndServe())` or `main` returning before `Shutdown` completes drops in-flight requests. Fix: wait for `Shutdown(ctxWithTimeout)`; treat ErrServerClosed as normal.
- **Long-lived connections**: `Shutdown` neither closes nor waits for hijacked/websocket connections, and waits forever for busy ones without a ctx deadline; no SIGTERM handling means abrupt kills. Fix: `signal.NotifyContext`, `RegisterOnShutdown`, then `Close`.
