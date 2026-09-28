---
name: JWT validation with golang-jwt
description: golang-jwt keyfuncs that don't pin the algorithm, v5 claims that are optional unless required (exp, aud, iss), using claims from failed parses or ParseUnverified, vulnerable jwt modules and MapClaims type assertions.
priority: 78
tags: [CWE-347, CWE-287, CWE-613]
activation:
  content:
    - 'github\.com/(?:golang-jwt|dgrijalva)/jwt'
    - '\bjwt\.(?:Parse\w{0,15}|NewParser|MapClaims|RegisteredClaims|StandardClaims|With\w{2,25}|SigningMethod\w{0,10}|Keyfunc)\b'
    - '\bParseUnverified\b'
  examples:
    - 'import "github.com/golang-jwt/jwt/v5"'
    - 'token, err := jwt.Parse(tokenStr, keyFunc, jwt.WithValidMethods([]string{"RS256"}))'
    - 'claims, _, err := new(jwt.Parser).ParseUnverified(tokenStr, jwt.MapClaims{})'
sources:
  - https://pkg.go.dev/github.com/golang-jwt/jwt/v5
  - https://github.com/advisories/GHSA-mh63-6h87-95cp
  - https://nvd.nist.gov/vuln/detail/CVE-2020-26160
---
- **Algorithm not pinned**: a keyFunc that returns the key without checking `token.Method`, and no `jwt.WithValidMethods(...)` → algorithm confusion (e.g., HS256 tokens verified with a PEM public key returned as `[]byte`) forges tokens. Fix: `WithValidMethods([]string{"RS256"})` plus a method type check.
- **Optional claims (v5)**: `exp`/`nbf` are validated only when present and `aud`/`iss`/`sub` only with `WithAudience`/`WithIssuer`/`WithSubject` → tokens without `exp` never expire; tokens for other services are accepted. Fix: `WithExpirationRequired()` and explicit audience/issuer.
- **Invalid tokens used**: reading `token.Claims` when `err != nil` or `!token.Valid`, `ParseUnverified` for authorization, or `WithoutClaimsValidation()` → forged or expired tokens accepted.
- **Vulnerable modules**: `github.com/dgrijalva/jwt-go` (unmaintained; CVE-2020-26160 audience bypass) and golang-jwt v4 < 4.5.2 / v5 < 5.2.2 (CVE-2025-30204 memory-exhaustion DoS in header parsing). Fix: current `github.com/golang-jwt/jwt/v5`.
- **MapClaims typing**: `claims["exp"].(int64)` or `claims["role"].(string)` without comma-ok panic or fail (JSON numbers are `float64`). Fix: typed claims structs embedding `jwt.RegisteredClaims`.
