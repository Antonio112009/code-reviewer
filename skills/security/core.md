---
name: Security (core)
description: Exploitable flaws in any language, such as missing authorization/IDOR, tainted data reaching interpreters or HTML, traversal, SSRF, unsafe deserialization, CSRF, unbounded work, fail-open paths, mass assignment, open redirects and races.
category: security
priority: 80
alwaysOn: true
tier: essential
tags:
  - CWE-862
  - CWE-639
  - CWE-89
  - CWE-78
  - CWE-88
  - CWE-79
  - CWE-22
  - CWE-434
  - CWE-918
  - CWE-502
  - CWE-352
  - CWE-1333
  - CWE-770
  - CWE-636
  - CWE-915
  - CWE-601
  - CWE-367
  - OWASP-A01
  - OWASP-A05
  - OWASP-A08
  - OWASP-A10
---
- **Missing authz / IDOR**: client-supplied id used without owner/tenant check, path id checked but body id used, or a handler missing its siblings' guard → foreign data. Fix: scope queries to the principal.
- **Injection**: external data concatenated into SQL, shell, `eval`, templates, LDAP/XPath or regexes; argv values starting with `-` → injection. Fix: bind parameters, argv arrays, `--`.
- **XSS**: untrusted data in hand-built HTML, unescaped template output, attribute/`<script>` contexts or `javascript:` URLs → session theft. Fix: context-aware escaping, sanitized rich text.
- **Files**: user paths or archive entries joined without resolve plus containment (`..`, absolute, symlinks); uploads trusting client name/MIME or served inline (SVG, HTML) → file access, RCE, XSS. Fix: resolved-prefix check, random names, `attachment`.
- **SSRF**: user-influenced URLs fetched server-side; blocklists miss redirects, DNS rebinding, IPv6/decimal IPs → internal and metadata access. Fix: check the resolved IP per hop.
- **Deserialization**: untrusted bytes into type-carrying decoders (object streams, polymorphic JSON/YAML, pickle) → RCE. Fix: plain data formats.
- **CSRF**: cookie-auth state change via GET or cross-site POST without token/Origin check; credentialed CORS reflecting any Origin → forged actions. Fix: token/Origin check, fixed CORS list.
- **Unbounded work**: client-controlled page size, depth, batch or decompressed size; nested-quantifier regexes on input → DoS. Fix: hard caps, linear-time regex.
- **Fail-open**: errors, timeouts or missing config in auth/validation end in allow (`catch` returns true, unknown role permitted) → bypass. Fix: deny by default.
- **Mass assignment**: request body spread or bound into a model → client sets `role` or `ownerId`. Fix: allowlist or DTO.
- **Open redirect**: target checked with `startsWith('/')` (passes `//evil.com`, `/\evil.com`) or substring host match → phishing, OAuth code theft. Fix: compare parsed origin.
- **Security races**: check-then-act on balances, coupons, one-time tokens or quotas without lock/unique constraint → double spend. Fix: atomic conditional update.
