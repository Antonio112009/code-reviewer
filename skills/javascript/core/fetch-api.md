---
name: fetch and AbortSignal
description: fetch resolving on HTTP errors, missing timeouts, single-use and empty bodies, aborts treated as failures, hand-built URLs and bodies, and cookies not sent cross-origin.
priority: 60
activation:
  content:
    - '\bfetch\s*\('
    - '\bnew\s+(?:Request|Response|AbortController|URLSearchParams)\b'
    - '\bAbortSignal\.(?:timeout|any)\s*\('
    - '\bres(?:ponse)?\.(?:json|text|blob|arrayBuffer|formData)\s*\(\s*\)|\bres(?:ponse)?\.(?:ok|bodyUsed)\b'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
  - https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
  - https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
  - https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#credentials
---
- **HTTP errors resolve**: `fetch` rejects only on network failure; 4xx/5xx resolve → `await res.json()` treats an error body as data or throws `SyntaxError` on an HTML error page. Fix: check `res.ok`/`status` before parsing.
- **No timeout**: `fetch` has no short default deadline → a stalled server leaves requests hanging and piling up. Fix: `signal: AbortSignal.timeout(ms)`; merge with a caller's signal via `AbortSignal.any` (Node ≥20.3, Safari 17.4).
- **Single-use and empty bodies**: reading the body twice (`res.text()` for a log, then `res.json()`) throws `TypeError`; `res.json()` on 204 or an empty 200 throws. Fix: read once or `res.clone()` first; check status before parsing.
- **Abort vs failure**: aborts reject with `AbortError`, `AbortSignal.timeout` with `TimeoutError` → catch blocks treating every rejection as an outage retry cancelled requests or show errors on navigation. Fix: branch on `err.name`.
- **Hand-built requests**: query strings concatenated without `URLSearchParams`/`encodeURIComponent` break or inject parameters (`&role=admin`); `body: obj` sends `[object Object]`; JSON without `Content-Type: application/json` is ignored by body parsers. Fix: `URL`, `JSON.stringify` + header.
- **Cookies not sent cross-origin**: the default `credentials: 'same-origin'` omits cookies on calls to an API on another origin (e.g. `api.` subdomain) → silent 401s or anonymous responses. Fix: set `credentials` deliberately.
