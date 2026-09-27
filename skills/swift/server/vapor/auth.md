---
name: Vapor authentication and sessions
description: Vapor 4 auth gaps — authenticators without guard middleware, JWT payloads that only check signatures, session middleware ordering and in-memory sessions, default session cookie flags and missing CSRF protection.
priority: 70
category: security
tags: [CWE-306, CWE-613, CWE-1004, CWE-352]
activation:
  content:
    - '\b\w+\.authenticator\(\)|\bguardMiddleware\(|\bredirectMiddleware\(|\breq\.auth\.|\b(?:Model|Session|Bearer|Basic)?Authenticatable\b|\bAsync\w*Authenticator\b'
    - '\bJWTPayload\b|\breq\.jwt\b|\bjwt\.keys\b|\bverifyNotExpired\(|\bverifyIntendedAudience\('
    - '\bapp\.sessions\b|\bSessionsMiddleware\b|\breq\.session\b|\bcookieFactory\b'
sources:
  - https://docs.vapor.codes/security/authentication/
  - https://docs.vapor.codes/security/jwt/
  - https://github.com/vapor/vapor/blob/4.122.2/Sources/Vapor/Sessions/SessionsConfiguration.swift
  - https://github.com/vapor/vapor/blob/4.122.2/Sources/Vapor/Sessions/Request%2BSession.swift
---
- **Authenticator without guard**: `.grouped(User.authenticator())` only tries to log the user in; without `User.guardMiddleware()` or `req.auth.require(User.self)`, unauthenticated requests reach the handler, and code using `req.auth.get` continues with `nil`.
- **Signature-only JWTs**: a `JWTPayload.verify(using:)` that doesn't call `exp.verifyNotExpired()` or check `aud`/`iss` → expired or foreign-issuer tokens are accepted.
- **Session wiring**: without `app.sessions.middleware` ahead of the session authenticator, `req.session` asserts in debug and silently uses a throwaway session in release → logins never persist. The default memory driver also loses sessions on restart and across instances.
- **Default session cookie**: Vapor 4's default cookie is `isSecure: false`, `isHTTPOnly: false`, `SameSite=Lax` with a one-week expiry → readable by injected scripts and sent over HTTP. Fix: a `cookieFactory` with `isSecure` and `isHTTPOnly`.
- **No CSRF protection**: cookie-authenticated form or JSON routes that change state have no built-in CSRF defence. Fix: tokens or `SameSite=Strict`, and non-GET methods for mutations.
