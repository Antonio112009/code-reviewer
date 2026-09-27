---
name: JWT verification in Java libraries
description: JWT handling bugs with JJWT, Auth0 java-jwt and Nimbus JOSE — decoding without verifying, accepting unsecured tokens, algorithms or keys chosen from the token header, missing exp/iss/aud checks and weak HMAC secrets.
priority: 78
tags: [CWE-347, CWE-345, CWE-287, A07:2025]
activation:
  content:
    - '\bJWT\.(?:decode|require)\('
    - '\bJwts\.parser'
    - '\b(?:SignedJWT|JWSVerifier|JWTClaimsSet|DecodedJWT|JwtParser|JWSObject|PlainJWT)\b'
    - '\.(?:parseClaimsJws|parseSignedClaims|parseClaimsJwt|parseUnsecuredClaims)\('
sources:
  - https://github.com/jwtk/jjwt
  - https://javadoc.io/static/com.auth0/java-jwt/4.4.0/com/auth0/jwt/JWT.html
  - https://connect2id.com/products/nimbus-jose-jwt/examples/validating-jwt-access-tokens
  - https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html
---
- **Decode is not verify**: Auth0 `JWT.decode(token)` ("doesn't verify the token's signature"), Nimbus `SignedJWT.parse(t).getJWTClaimsSet()` without `verify(...)`, or base64-decoding the payload → forged claims trusted. Fix: `JWT.require(alg).build().verify(token)`, `JWSVerifier`/`DefaultJWTProcessor`.
- **Unsecured tokens**: JJWT ≤ 0.11 `parse(token)`/`parseClaimsJwt` accept unsigned (`alg: none`) JWTs, and 0.12 does too once `.unsecured()` is enabled — generic `parse()` never asserts a signature. Fix: `parseSignedClaims` (0.12+) or `parseClaimsJws` (≤ 0.11) with a key.
- **Header-chosen algorithm or key**: picking the verifier from the token's `alg`/`kid`/`jku`/`jwk` without an allow-list (RSA public key used as an HMAC secret, attacker-hosted keys) → signature bypass. Fix: pin algorithms; resolve keys from trusted JWKS only.
- **Missing claim checks**: no required `exp`, `iss` or `aud` (java-jwt checks `exp` only when present) → non-expiring tokens or tokens minted for another service accepted. Fix: `withIssuer`/`withAudience` and require expiry.
- **Weak HMAC keys**: secrets from short strings (`"secret".getBytes()`) or config defaults → offline brute force; JJWT rejects HS256 keys under 256 bits (`WeakKeyException`) — don't work around it. Fix: ≥ 256-bit random keys from a secret store.
