---
name: Authentication and authorization
description: Identity and access defects, such as client-trusted roles and uncovered routes, tenant leaks, weak JWT validation, session and cookie lifecycle, password reset, identity normalization, brute force and enumeration, MFA bypass, OAuth/OIDC and SAML validation, and credential handling.
category: security
priority: 76
tier: essential
tags:
  - CWE-285
  - CWE-639
  - CWE-862
  - CWE-347
  - CWE-384
  - CWE-613
  - CWE-1004
  - CWE-640
  - CWE-178
  - CWE-204
  - CWE-307
  - CWE-308
  - CWE-346
  - OWASP-A01
  - OWASP-A07
activation:
  files:
    - "**/{auth,authn,authz,login,session,sessions,oauth,oidc,saml,sso,identity,permissions,policies,guards}/**"
    - "**/*{auth,Auth}{[^o]*,oriz*,oris*}"
    - "**/*{login,Login,logout,Logout,signin,SignIn,signup,SignUp,session,Session,oauth,OAuth,saml,Saml,SAML,jwt,Jwt,JWT,password,Password,mfa,Mfa,MFA,totp,Totp,permission,Permission}*"
    - "**/*{.guard,Guard}.*"
    - "**/{middleware,proxy}.{ts,js}"
  content:
    - \b(?:jsonwebtoken|jwtVerify|SignJWT|golang-jwt|NextAuth|getServerSession|passport|authenticate_user!|login_required|AuthGuard|SecurityFilterChain|AddAuthentication|AddAuthorization|SAMLResponse|saml2?|Saml2?)\b|\bjwt\.(?:sign|verify|decode|encode|Parse\w*)\(|@(?:PreAuthorize|Secured|login_required|UseGuards)\b|\[Authorize\b|from ['"](?:next-auth|@auth/[\w-]+|better-auth)['"]
    - \b(?:refresh_?[Tt]oken|RefreshToken|reset_?[Tt]oken|resetToken|password_?reset|passwordReset|id_?[Tt]oken|code_verifier|codeVerifier|code_challenge|redirect_uri|redirectUri|email_verified|totp|TOTP|otp|OTP|mfa|MFA|2fa)\b
    - \b(?:req|request)\.session\b|\bres\.cookie\(|\bcookies\(\)\.set\(|\b(?:set_cookie|Set-Cookie|httpOnly|HttpOnly|sameSite|SameSite|session_regenerate_id)\b|\b(?:bcrypt|argon2|password_hash|password_verify|check_password|verify_password)\b|\b(?:rateLimit|RateLimit|rate_limit|tenant_?[Ii]d|tenantId|TenantId)\b
  examples:
    - 'const payload = jwt.verify(token, publicKey, { algorithms: ["RS256"] });'
    - 'const { refreshToken } = req.body;'
    - 'res.cookie("session", id, { httpOnly: true, sameSite: "strict" });'
---
- **Enforcement gaps**: roles or ids from request data or unverified claims, UI-only checks, sibling handlers or jobs missing the check, `/Admin` or `%2F` variants passing prefix rules → access bypass. Fix: deny by default.
- **Tenant isolation**: queries, caches, search indexes or storage keys not scoped by the session tenant, or tenant ids from input → cross-tenant leaks. Fix: tenant from the principal.
- **JWT validation**: `decode` without verify, unpinned algorithms (`none`, RS/HS confusion), unchecked `exp`/`aud`/`iss`, header-chosen keys (`jku`, `kid`) → forged tokens. Fix: pin algorithm, audience, issuer.
- **Session lifecycle**: id not rotated at login; logout or password change leaving sessions and refresh tokens valid; cookies lacking `HttpOnly`/`Secure`/`SameSite` → hijack. Fix: rotate, revoke, `__Host-` cookies.
- **Password reset**: predictable, reusable, long-lived or plaintext-stored tokens, links built from the `Host` header → takeover. Fix: single-use hashed random tokens, fixed base URL.
- **Identity normalization**: emails or usernames case-folded or Unicode-normalized differently across signup, login and reset; reset mail sent to the typed address, not the stored one → takeover. Fix: canonicalize once.
- **Brute force**: login, OTP and reset without per-account and per-IP limits, limits keyed on spoofable `X-Forwarded-For`, responses or timing revealing unknown users → stuffing, enumeration. Fix: throttling.
- **MFA bypass**: session authenticated before the second factor, step two trusting a client flag, reusable OTPs, recovery paths skipping MFA → takeover. Fix: server-side MFA state.
- **OAuth/OIDC**: no `state`/PKCE, `redirect_uri` matched by prefix or regex, ID token `aud`/`nonce` unchecked, accounts linked by unverified email → login CSRF, code theft. Fix: exact redirect match.
- **SAML**: unsigned or partly signed responses, attributes read outside the signed element (wrapping), no audience, expiry or replay checks → impersonation. Fix: maintained library, strict settings.
- **Credentials**: `==` or plaintext password checks, bcrypt's 72-byte truncation (prefixed peppers or ids), email or password changes without re-authentication → takeover. Fix: library verify.
