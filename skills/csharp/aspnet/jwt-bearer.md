---
name: JWT bearer authentication
description: JwtBearer/TokenValidationParameters defects — validations switched off, custom signature validators, the default 5-minute ClockSkew, weak or committed signing keys, HTTP metadata, inbound claim-type mapping and .NET 8 JsonWebToken event objects.
priority: 74
tags: [CWE-287, CWE-347, CWE-345, A07:2025]
activation:
  content:
    - '\bTokenValidationParameters\b|\bAddJwtBearer\(|\bJwtBearerOptions\b|\bJwtBearerEvents\b'
    - '\bJwtSecurityToken\w*|\bJsonWebToken\w*|\bSymmetricSecurityKey\b'
    - '\b(?:Validate(?:Issuer|Audience|Lifetime|IssuerSigningKey)|RequireHttpsMetadata|MapInboundClaims|ClockSkew|SignatureValidator|RequireSignedTokens|RequireExpirationTime)\b'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication
  - https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/8/securitytoken-events
  - https://learn.microsoft.com/en-us/aspnet/core/security/authentication/claims
---
- **Validation switched off**: `ValidateIssuer`, `ValidateAudience` or `ValidateLifetime = false`, `RequireSignedTokens`/`RequireExpirationTime = false`, or a custom `SignatureValidator` that returns the token without verifying → forged, foreign or expired tokens accepted. Fix: keep defaults; set `ValidIssuer(s)`/`ValidAudience(s)`.
- **ClockSkew**: the default 5-minute `ClockSkew` extends every token's lifetime — short-lived tokens and revocation windows are longer than intended. Fix: set it deliberately (e.g. 30 s).
- **Keys**: short HS256 `SymmetricSecurityKey` secrets committed to appsettings or shared across services → anyone with config access mints tokens; `RequireHttpsMetadata = false` outside development → metadata/keys fetched over HTTP. Fix: asymmetric keys from the authority over HTTPS, secrets in a vault.
- **Claim mapping**: `MapInboundClaims` defaults to true (`sub` → `ClaimTypes.NameIdentifier`, `role` → `ClaimTypes.Role`) → `User.FindFirst("sub")` returns null and ownership checks compare against null/empty. Fix: one consistent setting; read the mapped type.
- **.NET 8 token type**: `JwtBearerEvents` now expose `JsonWebToken` → `context.SecurityToken as JwtSecurityToken` is null, skipping custom checks in `OnTokenValidated`. Fix: cast to `JsonWebToken`.
