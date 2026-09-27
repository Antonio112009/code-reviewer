---
name: OAuth2 resource server and JWT validation
description: Spring Security resource-server gaps — audience not validated by default, NimbusJwtDecoder built from JWK sets or public keys without issuer validation, custom decoders that skip verification and role/scope mapping mistakes.
priority: 76
tags: [CWE-287, CWE-345, CWE-863, A07:2025]
activation:
  content:
    - '\b(?:JwtDecoder|NimbusJwtDecoder|ReactiveJwtDecoder|JwtAuthenticationConverter|JwtGrantedAuthoritiesConverter|JwtValidators|OAuth2TokenValidator|JwtIssuerValidator|OpaqueTokenIntrospector)\b'
    - '\.oauth2ResourceServer\('
    - '\bresourceserver\b'
    - '^\s*(?:issuer-uri|jwk-set-uri|audiences|public-key-location|jws-algorithms?):'
sources:
  - https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html
  - https://docs.spring.io/spring-boot/reference/web/spring-security.html
---
- **Audience not checked**: by default only `exp`/`nbf` (and `iss` when `issuer-uri` is set) are validated → tokens the same IdP issued for other clients or APIs are accepted. Fix: `spring.security.oauth2.resourceserver.jwt.audiences` or an audience `OAuth2TokenValidator`.
- **Issuer not checked**: `NimbusJwtDecoder.withJwkSetUri(...)`/`withPublicKey(...)` (or `jwk-set-uri` without `issuer-uri`) skip `iss` validation → tokens from another realm or tenant sharing keys pass. Fix: `setJwtValidator(JwtValidators.createDefaultWithIssuer(issuer))`.
- **Custom decoders**: `JwtDecoder` implementations that base64-decode claims, or swallow validation errors → forged or expired tokens accepted. Fix: delegate to `NimbusJwtDecoder` with validators.
- **Authority mapping**: scopes become `SCOPE_x` authorities; roles in custom claims (`realm_access.roles`, `groups`) are ignored without a `JwtAuthenticationConverter` → `hasRole` never matches and gets "fixed" with `permitAll`; user-editable claims mapped to roles escalate privileges. Fix: a converter over trusted claims.
