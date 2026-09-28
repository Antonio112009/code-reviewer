---
name: Links, HTTP caching and subscriptions
description: tRPC transport pitfalls — responseMeta cache headers on batched private responses, httpBatchStreamLink headers that cannot change, GET batches over URL limits, body parsers placed before the adapter, FormData mutations and v11 async-generator subscriptions leaking or authenticating via URL.
priority: 62
tags: [CWE-524, CWE-352, CWE-400]
activation:
  content:
    - "\\bresponseMeta\\b|\\bhttp(?:Batch|BatchStream|Subscription)?Link\\b|\\bsplitLink\\b|\\bwsLink\\b|\\bmaxURLLength\\b"
    - "\\.subscription\\s*\\(|\\btracked\\s*\\(|\\bopts\\.signal\\b|\\bon\\s*\\(\\s*\\w+\\s*,\\s*['\"][\\w:-]+['\"]"
    - "\\bcreateExpressMiddleware\\s*\\(|\\bfetchRequestHandler\\s*\\(|\\bcreateHTTPServer\\s*\\(|\\boctetInputParser\\b|\\bFormData\\b"
  examples:
    - 'const link = httpBatchLink({ url });'
    - '.subscription(async function* () { yield event; });'
    - 'app.use(''/trpc'', createExpressMiddleware({ router }));'
sources:
  - https://trpc.io/docs/server/caching
  - https://trpc.io/docs/client/links/httpBatchStreamLink
  - https://trpc.io/docs/server/non-json-content-types
  - https://trpc.io/docs/server/subscriptions
---
- **Caching private data**: `responseMeta` setting `Cache-Control: public`/`s-maxage` on queries — batching (on by default) mixes private procedures into cached responses, so CDNs serve user data. Fix: cache only when every path is public and error-free; `splitLink` private calls.
- **Stream link headers**: with `httpBatchStreamLink` headers and status go out before procedures finish — cookies set in procedures (login, token refresh) are dropped and `responseMeta` gets no `data`. Fix: `httpBatchLink`/`httpLink` for those calls.
- **URL length**: GET batches of many queries or large inputs exceed proxy and CDN URL limits (414, truncation). Fix: `maxURLLength` on batch links; POST for big inputs.
- **Body parsed twice**: `express.json()` or other body parsers mounted before `createExpressMiddleware` consume the body, breaking FormData and binary procedures. Fix: mount tRPC first or exclude its path.
- **FormData mutations**: procedures accepting `FormData`/octet input receive CORS-simple content types, so cookie-authenticated ones can be triggered by cross-site forms. Fix: require a custom header or CSRF token; `SameSite` cookies.
- **Subscription cleanup**: v11 async-generator subscriptions must release listeners in `try/finally` and honour `opts.signal`; `ee.on()` without removal leaks per connection. Fix: `on(ee, 'event', { signal: opts.signal })`, `finally`.
- **Subscription auth**: `httpSubscriptionLink` (SSE) can't send headers — `connectionParams` travel in the URL query (logged by proxies) — and auth checked at subscribe time keeps streaming after logout. Fix: cookies or short-lived tokens; re-check per event.
