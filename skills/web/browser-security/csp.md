---
name: Content Security Policy
description: CSP configurations that don't stop XSS — unsafe-inline/unsafe-eval and wildcard sources, bypassable host allowlists, static or cached nonces, missing object-src/base-uri, directives ignored in <meta>, report-only policies and pass-through Trusted Types policies.
priority: 70
tags: [CWE-693, CWE-79, OWASP-A02]
activation:
  content:
    - 'Content-Security-Policy|\bcontentSecurityPolicy\b|\bcspDirectives\b'
    - '\b(?:default|script|style|object|img|connect|frame|worker)-src\b|\bbase-uri\b|\bstrict-dynamic\b'
    - '\bnonce\b|\brequire-trusted-types-for\b|\btrustedTypes\.createPolicy\('
  examples:
    - "res.setHeader('Content-Security-Policy', policy);"
    - "script-src 'self' 'nonce-${nonce}';"
    - "const policy = trustedTypes.createPolicy('default', { createHTML: (s) => s });"
sources:
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP
  - https://web.dev/articles/strict-csp
  - https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API
---
- **Unsafe sources**: `script-src` with `'unsafe-inline'` (and no nonce/hash), `'unsafe-eval'`, `*`, `https:`, `data:` or `blob:` → CSP doesn't stop injected scripts. Fix: nonce- or hash-based policy with `'strict-dynamic'`.
- **Bypassable allowlists**: host lists including CDNs, `*.googleapis.com`, analytics domains or anything serving JSONP, user uploads or old AngularJS → attackers load script from an allowed host. Fix: nonces/hashes instead of hosts.
- **Nonce misuse**: hard-coded nonces, one nonce generated at startup, nonces in statically generated or CDN-cached HTML, or reflected into attacker-influenced markup → no protection. Fix: ≥ 128-bit random value per response; don't cache nonce-bearing HTML.
- **Missing directives**: no `object-src 'none'` and `base-uri 'none'`/`'self'` → plugin or `<base>` injection hijacks relative script URLs; no `default-src` → unlisted resource types unrestricted. Fix: add them.
- **Ignored in `<meta>`**: `frame-ancestors`, `report-uri`/`report-to` and `sandbox` delivered via `<meta http-equiv>` are ignored → no clickjacking protection or reports. Fix: send the policy as an HTTP header.
- **Report-only in production**: only `Content-Security-Policy-Report-Only` sent → nothing enforced. Fix: enforce once reports are clean.
- **Pass-through Trusted Types**: `require-trusted-types-for 'script'` (Baseline 2026) with a `default` policy or `createHTML: (s) => s` → sinks stay unprotected. Fix: sanitize inside policies; named policies only.
