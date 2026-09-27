---
name: Proxies, limits, cookies and uploads
description: Fastify server and plugin settings with unsafe defaults — trustProxy, requestTimeout, request-id headers, @fastify/multipart bypassing bodyLimit or hanging on unconsumed streams, client file names and signed cookies used without checking valid.
priority: 62
tags: [CWE-348, CWE-400, CWE-22, CWE-565]
activation:
  content:
    - "\\btrustProxy\\b|\\brequestTimeout\\b|\\bbodyLimit\\b|\\brequestIdHeader\\b|\\bconnectionTimeout\\b"
    - "\\b(?:request|req)\\.(?:ip|ips|protocol)\\b"
    - "@fastify/(?:multipart|cookie|static|rate-limit|session|secure-session)"
    - "\\b(?:request|req)\\.(?:file|files|parts|saveRequestFiles)\\s*\\(|\\battachFieldsToBody\\b|\\bthrowFileSizeLimit\\b|\\bpart\\.filename\\b"
    - "\\bunsignCookie\\s*\\(|\\b(?:request|req)\\.cookies\\b"
sources:
  - https://fastify.dev/docs/latest/Reference/Server/
  - https://github.com/fastify/fastify-multipart
  - https://github.com/fastify/fastify-cookie
---
- **trustProxy**: `trustProxy: true` trusts any X-Forwarded-* → `request.ip`, `protocol` and `host` are client-controlled (rate limits, allowlists, links); leaving it off behind a load balancer makes every client one IP. Fix: proxy IPs/CIDRs.
- **No request timeout**: `requestTimeout` defaults to 0 — a server facing clients directly lets slow uploads and slowloris connections hold sockets. Fix: set it (e.g. 120 s) or front with a proxy.
- **Caller-chosen request ids**: `requestIdHeader` makes `request.id` whatever the client sends, unvalidated → log injection and spoofed correlation ids.
- **Multipart limits**: @fastify/multipart ignores `bodyLimit` — only `fileSize` (= bodyLimit) and `parts` (1000) have defaults; `attachFieldsToBody: true` buffers whole files in memory. Fix: set `files`, `fields`, `fieldSize`; stream to disk.
- **Unconsumed streams**: iterating `request.parts()`/`files()` without consuming every `part.file` never completes the request (hang); `throwFileSizeLimit: false` silently truncates (`file.truncated`).
- **Client file names**: `part.filename` and `mimetype` come from the client — `path.join(uploadDir, part.filename)` allows traversal and overwrites. Fix: generated names, content sniffing.
- **Signed cookies**: `request.cookies` holds raw values; `request.unsignCookie(v)` returns `{ valid, renew, value }` — using `.value` without checking `valid` accepts forged cookies.
