---
name: HTTP clients (requests, httpx, aiohttp, urllib)
description: Outbound HTTP reliability — no default timeout in requests/urllib, per-phase timeouts, unchecked status codes, httpx not following redirects, client-per-request pooling loss, unconsumed streams and retries of non-idempotent calls.
priority: 58
activation:
  content:
    - "\\brequests\\.(?:get|post|put|patch|delete|head|request|Session)\\b"
    - "\\bhttpx\\.\\w+|\\baiohttp\\.\\w+|\\b(?:ClientSession|AsyncClient)\\s*\\("
    - "\\burlopen\\s*\\(|\\burllib3\\b|\\bRetry\\s*\\("
    - "\\.(?:get|post|put|patch|delete|request|stream)\\s*\\([^)\\n]{0,160}\\b(?:timeout|stream|follow_redirects|allow_redirects)\\s*="
  examples:
    - 'resp = requests.get(url)'
    - 'client = httpx.AsyncClient()'
    - 'resp = urlopen(request)'
    - 'resp = session.get(url, timeout=5)'
sources:
  - https://requests.readthedocs.io/en/latest/user/advanced/#timeouts
  - https://www.python-httpx.org/compatibility/#redirects
  - https://docs.aiohttp.org/en/stable/client_quickstart.html#timeouts
  - https://urllib3.readthedocs.io/en/stable/reference/urllib3.util.html
---
- **No timeout**: `requests` calls and `urllib.request.urlopen` wait forever by default → a stalled server hangs the worker. Fix: `timeout=(connect, read)` on every call; set aiohttp (5 min default) and httpx (5 s) timeouts deliberately.
- **Timeouts are per phase**: requests' `timeout=10` bounds the connect and each gap between received bytes, not the whole download → slow-drip responses run far longer. Fix: an overall deadline (httpx/aiohttp total timeouts, streaming with elapsed checks).
- **Status not checked**: requests and httpx don't raise on 4xx/5xx → error pages parsed as data, failures reported as success. Fix: `raise_for_status()` or explicit status checks before `.json()`.
- **Redirect defaults differ**: requests follows redirects, httpx doesn't (`follow_redirects=False`) → after a migration 301/302 responses are treated as final. Fix: set `follow_redirects` explicitly.
- **Client per request**: a new `Session`, `httpx.Client`/`AsyncClient` or `aiohttp.ClientSession` per call (often never closed) loses pooling and keep-alive, leaks sockets and repeats TLS handshakes. Fix: one long-lived client per app or host, closed on shutdown.
- **Unreleased responses**: requests `stream=True`, httpx `client.stream()` or aiohttp responses not read to the end or closed keep their connection checked out → pool exhaustion and hangs. Fix: `with …`/`async with session.get(url) as resp:`.
- **Retrying non-idempotent calls**: urllib3 `Retry(allowed_methods=None)`, retry loops or tenacity around POST/PATCH resend payments and orders after a timeout. Fix: retry only idempotent methods, or send idempotency keys.
