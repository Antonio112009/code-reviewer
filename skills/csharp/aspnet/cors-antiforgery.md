---
name: CORS and antiforgery
description: Cross-origin and CSRF defects — credentialed CORS reflecting any origin, substring origin checks, CORS mistaken for authentication, MVC controllers without antiforgery validation and cookie-authenticated APIs accepting simple cross-site form posts.
priority: 72
tags: [CWE-942, CWE-346, CWE-352, A01:2025]
activation:
  content:
    - '\b(?:AddCors|UseCors|WithOrigins|AllowAnyOrigin|AllowCredentials|SetIsOriginAllowed\w*)\(|\[(?:EnableCors|DisableCors)\b'
    - '\bAntiforgery\w*\b|\[(?:ValidateAntiForgeryToken|IgnoreAntiforgeryToken|AutoValidateAntiforgeryToken)\b|\bDisableAntiforgery\('
    - '\[Consumes\(|\bOrigin\b'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/security/cors
  - https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery
---
- **Any origin with credentials**: `SetIsOriginAllowed(_ => true)` or echoing the request `Origin` together with `AllowCredentials()` → any website can make authenticated cross-origin reads (the framework rejects `AllowAnyOrigin()` + `AllowCredentials()` for this reason). Fix: explicit `WithOrigins(...)`.
- **Loose origin checks**: `origin.Contains("example.com")`/`EndsWith("example.com")` or broad `SetIsOriginAllowedToAllowWildcardSubdomains` → `example.com.evil.net`, `evilexample.com` accepted; origins with a trailing `/` never match. Fix: exact scheme+host comparison.
- **CORS isn't access control**: relaxing auth because "CORS limits callers" → CORS only governs browsers reading responses; curl, servers and simple form posts still reach the endpoint. Fix: authenticate and authorize server-side.
- **MVC without antiforgery**: cookie-authenticated controllers with views validate tokens only with `[ValidateAntiForgeryToken]`/`AutoValidateAntiforgeryTokenAttribute` (Razor Pages validate automatically); `[IgnoreAntiforgeryToken]` on state-changing actions → CSRF. Fix: global `AutoValidateAntiforgeryTokenAttribute`.
- **Simple-request CSRF on APIs**: cookie-authenticated endpoints that also accept `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain` → cross-site forms post without a preflight. Fix: `[Consumes("application/json")]` or antiforgery headers; token auth for APIs.
