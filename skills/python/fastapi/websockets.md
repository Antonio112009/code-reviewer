---
name: WebSockets
description: FastAPI/Starlette WebSocket defects — missing Origin checks (cross-site hijacking), accepting before authenticating, tokens in query strings, unhandled disconnects leaking registries, per-process broadcast lists and oversized messages.
priority: 66
tags: [CWE-1385, CWE-400]
activation:
  content:
    - '@\w+\.websocket\(|\bWebSocket\b|\bWebSocketRoute\('
    - '\bwebsocket\.(?:accept|receive\w*|send\w*|close|iter_\w+)\('
    - '\bWebSocketDisconnect(?:ed)?\b|--ws-max-size|\bws_max_size\b'
  examples:
    - '@app.websocket("/ws")'
    - 'await websocket.accept()'
    - 'except WebSocketDisconnect:'
sources:
  - https://fastapi.tiangolo.com/advanced/websockets/
  - https://starlette.dev/websockets/
  - https://uvicorn.dev/settings/
  - https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
---
- **No Origin check**: browsers attach cookies to cross-site WebSocket handshakes and CORS does not apply → any site can drive a cookie-authenticated socket. Fix: compare `websocket.headers.get("origin")` with an allowlist before `accept()`.
- **Accept before auth**: `await websocket.accept()` before validating credentials lets anonymous clients hold connections and receive early broadcasts. Fix: authenticate first, else `close(code=1008)`.
- **Token in the query string**: browsers cannot set an `Authorization` header on WebSockets, so tokens often go in `?token=` and end up in proxy and access logs. Fix: short-lived single-use tickets.
- **Unhandled disconnects**: loops that do not catch `WebSocketDisconnect` (Starlette 1.7 raises `WebSocketDisconnected` for sends after close) leave entries in connection registries → memory leaks and errors on broadcast. Fix: `try/finally` removal.
- **Per-process broadcast**: an in-memory list of connections only reaches clients on the same worker. Fix: Redis pub/sub or another broker.
- **Message size and rate**: uvicorn accepts messages up to 16 MiB (`--ws-max-size`) and the loop has no per-connection rate limit → memory and CPU abuse. Fix: lower the limit, validate and throttle messages.
