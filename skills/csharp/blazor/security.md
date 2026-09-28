---
name: Blazor security boundaries
description: Blazor trust-boundary defects — authorization only in client-side components, secrets shipped to WebAssembly, MarkupString XSS, trusting UI state in server event handlers, detailed circuit errors, .NET 9+ WebSocket compression/framing settings and open redirects via NavigateTo.
priority: 72
tags: [CWE-602, CWE-79, CWE-200, CWE-601, A01:2025]
activation:
  content:
    - '\bMarkupString\b|<AuthorizeView\b|\[Authorize\b|\bAuthenticationStateProvider\b'
    - '\bDetailedErrors\b|\bCircuitOptions\b|\bContentSecurityFrameAncestorsPolicy\b|\bDisableWebSocketCompression\b'
    - '\bNavigateTo\(|\b(?:ApiKey|ClientSecret|ConnectionStrings?)\b'
  examples:
    - '@((MarkupString)userSuppliedHtml)'
    - '<AuthorizeView Roles="Admin">'
    - '[Authorize(Roles = "Admin")]'
    - 'public class CustomAuthStateProvider : AuthenticationStateProvider'
    - 'options.DetailedErrors = builder.Environment.IsDevelopment();'
    - 'builder.Services.Configure<CircuitOptions>(o => o.DetailedErrors = false);'
    - 'options.ContentSecurityFrameAncestorsPolicy = frameAncestorsPolicy;'
    - 'options.DisableWebSocketCompression = true;'
    - 'NavigationManager.NavigateTo(returnUrl, forceLoad: true);'
    - 'var apiKey = Configuration["ApiKey"];'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/security/
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/security/webassembly/
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/security/interactive-server-side-rendering
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/signalr
---
- **Client-side authorization is cosmetic**: `[Authorize]`, `<AuthorizeView>` and role checks in WebAssembly/Auto components only hide UI — users can modify client code and call the APIs directly. Fix: enforce every rule in the server API.
- **Secrets on the client**: API keys, client secrets or connection strings in the `.Client` project, `wwwroot/appsettings*.json` or compiled into WASM assemblies are downloadable by anyone. Fix: keep them server-side (backend-for-frontend or API proxy).
- **MarkupString XSS**: `@((MarkupString)html)` with user or database content renders raw HTML/script in the app origin. Fix: render as text, or sanitize with an allowlist.
- **Trusting UI state on the server**: disabled or CSS-hidden buttons still have live `@onclick` handlers, and a modified client can dispatch their events or send other values over the circuit → admin actions reachable. Fix: don't render forbidden controls; re-check authorization and validate inputs in handlers.
- **Detailed errors**: `DetailedErrors`/`CircuitOptions.DetailedErrors = true` outside development sends exception details to the browser. Fix: development only.
- **Compression and framing (.NET 9+)**: WebSocket compression for interactive server components is on by default; setting `ContentSecurityFrameAncestorsPolicy = null` or mixing attacker-controlled data with secrets in one component raises clickjacking and CRIME/BREACH-style risk. Fix: keep `frame-ancestors 'self'`/`'none'` or `DisableWebSocketCompression`.
- **Open redirect**: `NavigationManager.NavigateTo(returnUrl, forceLoad: true)` with a query-supplied URL → phishing. Fix: allow only relative, same-origin targets.
