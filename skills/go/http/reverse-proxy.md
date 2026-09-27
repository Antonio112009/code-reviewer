---
name: httputil.ReverseProxy
description: Director (deprecated in Go 1.26) versus Rewrite — hop-by-hop header stripping, spoofed X-Forwarded-For, Host header, open-proxy targets and upstream timeouts.
priority: 62
tags: [CWE-348, CWE-441, CWE-918]
activation:
  content:
    - '\bhttputil\.(?:ReverseProxy|NewSingleHostReverseProxy|ProxyRequest)\b'
    - '\b(?:Director|Rewrite|ModifyResponse|ErrorHandler)\s*[:=]'
    - '\.(?:SetXForwarded|SetURL)\('
sources:
  - https://pkg.go.dev/net/http/httputil#ReverseProxy
  - https://go.dev/doc/go1.26
  - https://go.dev/doc/go1.20
---
- **Director strips your headers**: with `Director`, clients can list headers in `Connection` so they are removed as hop-by-hop after Director ran → auth/tenant headers added by the proxy never arrive. Fix: `Rewrite` (Go 1.20+; Director deprecated in 1.26).
- **Spoofed client IP**: `Director`/`NewSingleHostReverseProxy` keep the client's `X-Forwarded-For` and append to it → upstream rate limits and audit trust forged IPs. Fix: `Rewrite` (inbound Forwarded/X-Forwarded-* are removed) + `pr.SetXForwarded()`.
- **Host header**: `NewSingleHostReverseProxy` does not rewrite `Host` → upstream virtual-host routing, absolute URL generation and cache keys use the client-supplied host. Fix: `pr.SetURL(target)` and set `pr.Out.Host` deliberately.
- **Open proxy**: target URL or host taken from the request (query parameter, header, path) → proxy into internal networks. Fix: fixed upstream allowlist.
- **Upstream timeouts**: the default Transport has no `ResponseHeaderTimeout` → hung upstreams pin client connections and goroutines. Fix: a dedicated Transport with dial/header timeouts.
- **Error leakage**: custom `ErrorHandler`/`ModifyResponse` writing `err.Error()` exposes internal addresses and ports. Fix: generic 502 body, log details.
