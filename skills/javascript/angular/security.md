---
name: Sanitization, XSS and XSRF
description: Angular XSS and CSRF defects — bypassSecurityTrust* on untrusted data, DOM sinks that skip the sanitizer, attacker-chosen resource URLs, template injection, disabled or misaligned XSRF and static CSP nonces.
category: security
priority: 72
tags: [CWE-79, CWE-352, CWE-1336]
activation:
  content:
    - "\\bbypassSecurityTrust(?:Html|Script|Style|Url|ResourceUrl)\\b"
    - "\\bDomSanitizer\\b"
    - "\\bnativeElement\\.(?:innerHTML|outerHTML|insertAdjacentHTML)\\b"
    - "\\bsetProperty\\s*\\([^)\\n]{0,80}innerHTML"
    - "\\[innerHTML\\]"
    - "\\b(?:withNoXsrfProtection|withXsrfConfiguration|HttpClientXsrfModule)\\b"
    - "\\b(?:CSP_NONCE|ngCspNonce|autoCsp)\\b"
    - "\\bcompileModuleAsync\\b"
  examples:
    - 'this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(content);'
    - 'constructor(private sanitizer: DomSanitizer) {}'
    - 'this.el.nativeElement.innerHTML = comment.body;'
    - 'this.renderer.setProperty(el, ''innerHTML'', content);'
    - '<div [innerHTML]="comment.body"></div>'
    - 'provideHttpClient(withNoXsrfProtection());'
    - '{ provide: CSP_NONCE, useValue: nonce },'
    - 'const factory = await compiler.compileModuleAsync(AppModule);'
sources:
  - https://angular.dev/best-practices/security
  - https://angular.dev/api/platform-browser/DomSanitizer
---
- **Trusting untrusted values**: `bypassSecurityTrustHtml/Url/ResourceUrl/Style/Script` on API, route or user data (often to silence sanitizer warnings) → XSS. Fix: plain `[innerHTML]` (sanitized) or DOMPurify first; bypass only constants.
- **Bypassing the template sanitizer**: `ElementRef.nativeElement.innerHTML` or `Renderer2.setProperty(el, 'innerHTML', …)` with dynamic data → unlike `[innerHTML]`, no Angular sanitization. Fix: template bindings, or `DomSanitizer.sanitize(SecurityContext.HTML, v)`.
- **Attacker-chosen resource URLs**: `bypassSecurityTrustResourceUrl(userUrl)` for `<iframe src>`, `<script src>` or `<object data>` → hostile code or pages embedded. Fix: build URLs from an allowlisted origin plus encoded ids.
- **Template injection**: user input concatenated into Angular template strings (JIT/runtime compilation, server-side templating that emits `{{ }}`) → expressions execute. Fix: AOT only; escape server output before Angular sees it.
- **XSRF gaps**: `withNoXsrfProtection()`, cookie/header names that differ from the backend, or state-changing GETs; the token is only added to mutating same-origin/relative requests → absolute cross-origin API calls get none. Fix: align `withXsrfConfiguration` with backend CSRF checks.
- **Static CSP nonce**: a hard-coded `ngCspNonce`/`CSP_NONCE` value reused across responses → CSP no longer blocks injected scripts. Fix: a random nonce per request, or `autoCsp`.
