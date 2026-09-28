---
name: Ktor security configuration
description: Ktor security plugins misconfigured — JWT without audience/issuer checks, unsigned client-side sessions and insecure cookies, in-memory session storage, CORS anyHost with credentials, spoofable forwarded headers, optional authentication, development mode and shutdown URLs in production.
priority: 70
tags: [CWE-287, CWE-345, CWE-346, CWE-614, OWASP-A07]
activation:
  content:
    - '\bjwt\s*(?:\(\s*"[^"\n]*"\s*\))?\s*\{|\bJWT\.(?:require|decode)\s*\('
    - '\b(?:withAudience|withIssuer|verifier|validate)\s*[({]'
    - '\bcookie\s*<|\bheader\s*<\w+>\s*\(|\bSessionTransportTransformer\w*'
    - '\bSessionStorageMemory\b|\bcookie\.secure\b'
    - '\binstall\s*\(\s*(?:CORS|XForwardedHeaders|ForwardedHeaders|ShutDownUrl\.\w+)\b'
    - '\b(?:anyHost|allowCredentials)\b'
    - '\bAuthenticationStrategy\.Optional\b|\boptional\s*=\s*true\b'
    - '\bdevelopment\s*[:=]\s*true\b|\bio\.ktor\.development\b|\bshutdown\.url\b'
  examples:
    - 'jwt("auth-jwt") { verifier(jwkProvider) }'
    - 'cookie<UserSession>("session")'
    - 'cookie.secure = true'
    - 'install(CORS) { anyHost() }'
    - 'authenticate("jwt", optional = true) { get("/me") { } }'
    - 'development = true'
sources:
  - https://ktor.io/docs/server-jwt.html
  - https://ktor.io/docs/server-sessions.html
  - https://ktor.io/docs/server-forward-headers.html
  - https://github.com/ktorio/ktor/blob/main/ktor-server/ktor-server-plugins/ktor-server-cors/common/src/io/ktor/server/plugins/cors/CORSUtils.kt
---
- **Weak JWT validation**: `verifier(…)` without `withAudience`/`withIssuer`, `validate {}` returning a principal without checking claims, or decisions based on `JWT.decode` (unverified) → foreign or forged tokens accepted. Fix: verify signature, audience, issuer, expiry.
- **Unsigned client sessions**: `cookie<Session>("s")` without `transform(SessionTransportTransformerMessageAuthentication/Encrypt)` keeps the payload editable → users change their ID or role. Fix: sign/encrypt or server-side storage (not the dev-only `SessionStorageMemory`); `cookie.secure = true`.
- **Ktor 3 upgrade**: `SessionTransportTransformerEncrypt` now MACs the ciphertext → sessions from 2.x stop decoding (mass logout). Fix: `backwardCompatibleRead = true` while migrating.
- **CORS reflection**: `anyHost()` with `allowCredentials = true` echoes the caller's `Origin` → any site makes credentialed requests and reads responses. Fix: `allowHost(...)` allowlist.
- **Spoofable client IP**: `XForwardedHeaders`/`ForwardedHeaders` on a server reachable without the proxy, or the default first (client-controlled) `X-Forwarded-For` entry → spoofed IPs in rate limits, allowlists, audit logs. Fix: `skipLastProxies`/`skipKnownProxies`.
- **Optional authentication**: routes under `AuthenticationStrategy.Optional` run without a principal → `call.principal()!!` crashes or ownership checks are skipped. Fix: handle null explicitly.
- **Production switches**: `ktor.development = true` (stack traces in error pages, auto-reload) or a reachable `ktor.deployment.shutdown.url` (unauthenticated shutdown). Fix: disable both in production.
