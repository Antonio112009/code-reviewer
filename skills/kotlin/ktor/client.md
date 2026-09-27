---
name: Ktor HttpClient
description: Ktor client defects — HttpClient created per request and never closed, non-2xx responses treated as success (expectSuccess is false), no request timeouts, large downloads buffered in memory (Ktor 3.2+), and Authorization headers written by the Logging plugin.
priority: 62
tags: [CWE-400, CWE-532, CWE-252]
activation:
  content:
    - '\bHttpClient\s*[({]'
    - '\bexpectSuccess\b'
    - '\binstall\s*\(\s*(?:HttpTimeout|Logging|HttpRequestRetry|Auth)\b'
    - '\.(?:get|post|put|delete|request|prepareGet|prepareRequest)\s*\('
    - '\.(?:body|bodyAsText|bodyAsChannel|bodyAsBytes)\s*[<(]'
    - '\bsanitizeHeader\s*\(|\bLogLevel\.(?:ALL|HEADERS|BODY)\b'
sources:
  - https://ktor.io/docs/client-create-and-configure.html
  - https://ktor.io/docs/client-response-validation.html
  - https://ktor.io/docs/client-timeout.html
  - https://ktor.io/docs/whats-new-320.html
---
- **Client per request**: `HttpClient()` built inside a function or handler, or never `close()`d → each instance owns engine threads, connection pools and a scope → leaks, exhausted sockets. Fix: one shared client closed on shutdown.
- **Errors look like success**: `expectSuccess` defaults to `false`, so 4xx/5xx responses return normally → `body<Dto>()` fails deserializing the error body, or the error is silently treated as data. Fix: `expectSuccess = true` or check `response.status` before `body()`.
- **No timeouts**: without `install(HttpTimeout)` (or a per-request `timeout {}`) only engine defaults apply → a hanging upstream pins coroutines and connections. Fix: set request/connect/socket timeouts.
- **Downloads buffered in memory**: `client.get(url)` saves the whole body in memory before `bodyAsChannel()` (`skipSavingBody()` is deprecated since 3.2) → large downloads OOM. Fix: stream with `client.prepareGet(url).execute { it.bodyAsChannel() … }`.
- **Secrets in logs**: `install(Logging) { level = LogLevel.ALL/HEADERS }` logs `Authorization` and cookie headers unless `sanitizeHeader { it == HttpHeaders.Authorization }` is set. Fix: sanitize headers; `INFO`/`NONE` in production.
