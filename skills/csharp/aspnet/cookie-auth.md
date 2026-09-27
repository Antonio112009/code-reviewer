---
name: Cookie authentication and Identity sign-in
description: Cookie and ASP.NET Core Identity sign-in defects — insecure cookie flags, no server-side revocation, lockout disabled in PasswordSignInAsync, open redirects via returnUrl and login redirects returned to API clients before .NET 10.
priority: 72
tags: [CWE-614, CWE-307, CWE-601, CWE-613, A07:2025]
activation:
  content:
    - '\bAddCookie\(|\bCookieAuthenticationOptions\b|\bConfigureApplicationCookie\(|\b(?:SecurePolicy|ExpireTimeSpan|SlidingExpiration|HttpOnly)\b'
    - '\bSign(?:In|Out)Async\(|\bPasswordSignInAsync\(|\bSignInManager\b|\bValidatePrincipal\b'
    - '\breturnUrl\b|\b(?:Local)?Redirect\(|\bIsLocalUrl\(|\bOnRedirectTo(?:Login|AccessDenied)\b'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie
  - https://learn.microsoft.com/en-us/aspnet/core/security/preventing-open-redirects
  - https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/10/cookie-authentication-api-endpoints
  - https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-configuration
---
- **Cookie flags**: `Cookie.SecurePolicy` other than `Always` (TLS terminated at a proxy makes requests look like http), `HttpOnly = false`, `SameSite = None` without a cross-site need, long `ExpireTimeSpan` with `SlidingExpiration` → theft and CSRF exposure. Fix: `Always`, `HttpOnly`, `Lax`/`Strict`, bounded lifetimes.
- **No revocation**: cookie auth is stateless — `SignOutAsync` clears the browser cookie but a copied cookie stays valid until expiry; password/role changes aren't seen. Fix: `ValidatePrincipal` or Identity's security-stamp validation, server-side ticket store for revocation.
- **Lockout disabled**: `PasswordSignInAsync(user, password, persistent, lockoutOnFailure: false)` — the scaffolded default — allows unlimited password guessing. Fix: `lockoutOnFailure: true` plus rate limiting.
- **Open redirect**: `Redirect(returnUrl)`/`Results.Redirect(returnUrl)` with a query-supplied value (`//evil.com`, `https:evil.com`) → phishing after login. Fix: `LocalRedirect`, `Url.IsLocalUrl`.
- **API redirects (≤ .NET 9)**: cookie auth answers unauthenticated/forbidden API calls with 302 to the login page (except XHR) → clients follow and treat HTML as success. .NET 10 returns 401/403 for known API endpoints. Fix (older): handle `OnRedirectToLogin`/`OnRedirectToAccessDenied`.
