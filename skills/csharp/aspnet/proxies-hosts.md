---
name: Proxies, forwarded headers and host names
description: Reverse-proxy defects — trusting X-Forwarded-* from anyone, proxies missing from KnownProxies (8.0.17/9.0.6 behaviour change), UseForwardedHeaders placed late, absolute URLs built from spoofable Host headers and manual X-Forwarded-For parsing.
priority: 70
tags: [CWE-348, CWE-644, CWE-290]
activation:
  content:
    - '\bForwardedHeaders(?:Options)?\b|\bUseForwardedHeaders\(|\bKnown(?:Proxies|Networks|IPNetworks)\b|\bForwardLimit\b'
    - 'X-Forwarded-|X-Real-IP|ASPNETCORE_FORWARDEDHEADERS_ENABLED|\bRemoteIpAddress\b'
    - '\bRequest\.(?:Host|Scheme)\b|\bGet(?:Display|Encoded)Url\(|"AllowedHosts"\s*:|\bUseHttpsRedirection\('
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer
  - https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/8/forwarded-headers-unknown-proxies
  - https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/10/ipnetwork-knownnetworks-obsolete
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/host-filtering
---
- **Trusting any proxy**: `KnownNetworks.Clear()`/`KnownProxies.Clear()` (also done by `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`) or `ForwardLimit = null` → clients spoof `X-Forwarded-For/Proto/Host`: fake `RemoteIpAddress` for allowlists, rate limits and audit logs; fake HTTPS. Fix: list the real proxies/CIDRs (`KnownIPNetworks` in .NET 10).
- **Proxy not listed**: since 8.0.17/9.0.6 headers from unlisted proxies are ignored → `RemoteIpAddress` is the proxy (all users share one rate-limit bucket), scheme stays http → HTTPS redirect loops, non-secure cookies. Fix: configure the actual ingress addresses.
- **Late UseForwardedHeaders**: after HTTPS redirection, authentication, logging or rate limiting → those see proxy values. Fix: run it first.
- **Host header trust**: absolute URLs built from `Request.Host`/`Request.Scheme` (password-reset and confirmation links, OAuth callbacks) with `"AllowedHosts": "*"` or unrestricted `X-Forwarded-Host` → host-header poisoning sends tokens to attacker domains. Fix: configured public base URL, restrictive `AllowedHosts`.
- **Manual X-Forwarded-For**: taking the first (leftmost) value of `X-Forwarded-For` → client-controlled. Fix: forwarded-headers middleware with known proxies, or the right-most untrusted hop.
