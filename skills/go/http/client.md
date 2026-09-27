---
name: net/http client
description: Clients without timeouts, response bodies left open or undrained, non-2xx treated as success, per-request Transports, unbounded response reads, retried consumed bodies and SSRF through user-supplied URLs.
priority: 62
tags: [CWE-400, CWE-404, CWE-918]
activation:
  content:
    - '\bhttp\.(?:Get|Post|PostForm|Head|NewRequest\w{0,11}|DefaultClient|DefaultTransport|Client|Transport)\b'
    - '\.Do\(\s*req'
    - '\bresp\.(?:Body|StatusCode)\b'
    - '\b(?:CheckRedirect|MaxIdleConns\w{0,7}|DialContext)\b'
sources:
  - https://pkg.go.dev/net/http#Client
  - https://pkg.go.dev/net/http#Response
  - https://pkg.go.dev/net/http#Transport
  - https://go.dev/doc/go1.27
---
- **No timeout**: `http.Get/Post`, `http.DefaultClient` and `&http.Client{}` never time out → a stalled server hangs goroutines forever. Fix: `Client.Timeout` or ctx deadlines (Timeout also covers reading the body; size it for downloads).
- **Body lifecycle**: every returned `resp.Body` must be closed on all paths, including non-2xx; before Go 1.27 closing without reading to EOF also prevented connection reuse. Fix: `defer resp.Body.Close()` right after the err check.
- **Status ignored**: `Do` returns a nil error for 4xx/5xx → error pages decoded as data, failures reported as success. Fix: check `resp.StatusCode`.
- **Client per request**: building a `Transport` (or a Client with a new one) per call → no connection reuse, leaked idle connections and FDs; the default `MaxIdleConnsPerHost` is 2 → connection churn under concurrency. Fix: one shared, tuned client.
- **Unbounded reads**: `io.ReadAll(resp.Body)` on third-party responses → memory exhaustion. Fix: `io.LimitReader(resp.Body, max+1)` and reject larger bodies.
- **Retries and redirects**: re-sending a request whose `Body` was consumed sends it empty; 301/302/303 turn POST into GET without body. Fix: rebuild bodies (`GetBody`), explicit `CheckRedirect`.
- **SSRF**: fetching user-supplied URLs with the default client follows redirects and resolves DNS at dial time → internal hosts (169.254.169.254, localhost) reachable after the hostname check passed. Fix: validate the dialed IP in `net.Dialer.Control`; restrict `CheckRedirect`.
