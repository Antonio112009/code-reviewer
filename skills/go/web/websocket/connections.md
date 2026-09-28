---
name: WebSocket origin checks, limits and connection handling
description: Cross-site WebSocket hijacking through disabled origin checks, missing read limits, concurrent writes, unread control frames and per-connection goroutines without deadlines.
priority: 66
tags: [CWE-1385, CWE-400, CWE-362]
activation:
  content:
    - '\b(?:CheckOrigin|OriginPatterns|InsecureSkipVerify)\b'
    - '\bwebsocket\.(?:Upgrader|Accept|Dial|Conn|AcceptOptions)\b'
    - '\.(?:WriteMessage|WriteJSON|ReadMessage|ReadJSON|NextReader|NextWriter|SetReadLimit|SetPongHandler|CloseRead)\('
  examples:
    - 'upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}'
    - 'conn.SetReadLimit(maxMessageSize)'
sources:
  - https://pkg.go.dev/github.com/gorilla/websocket
  - https://pkg.go.dev/github.com/coder/websocket
---
- **Origin check disabled**: gorilla `CheckOrigin: func(*http.Request) bool { return true }` or coder `AcceptOptions{InsecureSkipVerify: true}` let any website open a socket with the victim's cookies (cross-site WebSocket hijacking). Fix: default same-origin check or `OriginPatterns`.
- **No read limit**: gorilla has no default message limit (coder: 32 KiB, `-1` disables) → a client sends one huge message and the server buffers it all. Fix: `conn.SetReadLimit(n)` per connection.
- **Concurrent writes**: gorilla supports one concurrent writer — `WriteMessage`/`WriteJSON` from several goroutines (broadcast loops, per-event handlers) panics with "concurrent write to websocket connection". Fix: one writer goroutine fed by a channel.
- **Unread connections**: control frames (ping, pong, close) are processed only while reading — write-only connections never notice disconnects and leak. Fix: a read loop (coder: `CloseRead`), pong handler that extends the read deadline, periodic pings.
- **Per-connection lifetime**: reader/writer goroutines without deadlines or a shared cancel keep running after the peer vanished; using `r.Context()` after the upgrade is unreliable (hijacked). Fix: own ctx per connection; close both sides on first error.
