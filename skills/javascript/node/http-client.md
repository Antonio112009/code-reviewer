---
name: HTTP clients (fetch/undici, http.request, axios)
description: Unconsumed fetch bodies exhausting undici's pool, missing or non-aborting timeouts, http.request error and response handling, keep-alive reuse races, unlimited response sizes and axios absolute URLs overriding baseURL.
priority: 60
tags: [CWE-400, CWE-918]
activation:
  content:
    - '\bfetch\s*\('
    - '(?<![.\w$])(?:http|https)\.(?:request|get)\s*\('
    - '\baxios\b|\bundici\b|\bgot\s*\('
    - '\b(?:globalAgent|keepAlive|maxSockets|maxContentLength|maxBodyLength|maxRedirects|baseURL|allowAbsoluteUrls)\b'
  examples:
    - 'const res = await fetch(url);'
    - 'https.get(url, (res) => {});'
    - 'import axios from "axios";'
    - 'axios.create({ baseURL: "https://api.example.com", maxRedirects: 5 });'
sources:
  - https://undici.nodejs.org/#/?id=garbage-collection
  - https://nodejs.org/api/http.html#event-timeout
  - https://nodejs.org/api/http.html#httpglobalagent
  - https://github.com/axios/axios#request-config
---
- **Unconsumed fetch bodies**: Node's `fetch` (undici) holds the connection until the body is read or cancelled - GC is too lazy → an early `return` on `!res.ok` exhausts the pool and later requests stall. Fix: `await res.body?.cancel()` or read the body.
- **Timeouts that don't exist or don't abort**: undici waits 300 s for headers and between body chunks; axios `timeout` defaults to `0` (none); `http.request`'s `timeout` only emits `'timeout'` - the request continues until destroyed. Fix: `AbortSignal.timeout()`, explicit axios `timeout`, `req.destroy()`.
- **`http.request` handling**: no `req.on('error')` → DNS or connection failures crash the process; a `'response'` handler that never reads or `resume()`s the body leaks the socket and memory. Fix: handle errors, always consume the response.
- **Keep-alive reuse races**: `http.globalAgent` keeps sockets alive since Node 19; reusing one the server just closed fails with `ECONNRESET`. Fix: retry only idempotent requests (blind POST retries duplicate writes).
- **Unlimited sizes**: axios `maxContentLength`/`maxBodyLength` default to `-1` (unlimited, decompression bombs included) and `maxRedirects` to 21. Fix: set limits for untrusted servers.
- **axios `baseURL` override**: an absolute or `//host` URL in the path overrides `baseURL` (`allowAbsoluteUrls` defaults to `true`) → default auth headers go to another host (SSRF, credential leak). Fix: `encodeURIComponent` path segments; `allowAbsoluteUrls: false`.
