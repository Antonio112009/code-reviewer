---
name: HTTP server timeouts and lifecycle
description: keepAliveTimeout below the proxy's idle timeout, disabled request/header timeouts, unbounded request bodies, responses never ended or written twice, work after client disconnect, insecureHTTPParser and graceful close.
priority: 60
tags: [CWE-400, CWE-444]
activation:
  content:
    - '\b(?:http|https|http2)\.createServer\s*\(|\bcreateServer\s*\('
    - '\b(?:keepAliveTimeout|headersTimeout|requestTimeout|maxRequestsPerSocket|insecureHTTPParser|maxHeaderSize)\b'
    - '\bserver\.(?:close|listen|setTimeout|closeIdleConnections|closeAllConnections)\s*\('
    - '\breq\.on\s*\(\s*[''"](?:data|end|close|aborted)[''"]|\bres\.writeHead\s*\('
sources:
  - https://nodejs.org/api/http.html#serverkeepalivetimeout
  - https://nodejs.org/api/http.html#serverrequesttimeout
  - https://nodejs.org/api/http.html#servercloseidleconnections
  - https://nodejs.org/en/learn/getting-started/security-best-practices
---
- **Keep-alive shorter than the proxy's**: `server.keepAliveTimeout` is 5 s by default through Node 26 (65 s planned for 27) → behind a proxy with a longer idle timeout (ALB: 60 s) reused sockets get closed → sporadic 502/`ECONNRESET`. Fix: exceed the proxy's timeout.
- **Timeouts disabled**: `requestTimeout: 0`/`headersTimeout: 0` (to fix slow uploads) plus the default `server.timeout = 0` let slow clients hold sockets forever → slowloris DoS without a proxy. Fix: keep finite timeouts; extend per route.
- **Unbounded request bodies**: accumulating `req.on('data')` chunks without a byte cap (trusting `Content-Length`) → memory DoS. Fix: count bytes, abort with 413, stream large bodies to disk.
- **Response lifecycle**: an error branch that never calls `res.end()` hangs until timeout; writing after `end` or a second `writeHead` throws `ERR_STREAM_WRITE_AFTER_END`/`ERR_HTTP_HEADERS_SENT`, often from async code. Fix: one exit path, check `res.headersSent`.
- **Work after disconnect**: expensive DB/API work continues after the client aborted. Fix: watch `res.on('close')` with `!res.writableFinished` and abort downstream calls via an `AbortSignal`.
- **Parser options and shutdown**: `insecureHTTPParser: true` enables request smuggling behind proxies; `server.close()` waits for keep-alive and in-flight requests → deploys hang until SIGKILL. Fix: default parser; `closeIdleConnections()`, then `closeAllConnections()` after a deadline.
