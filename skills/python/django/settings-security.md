---
name: Security settings
description: Django settings that silently weaken production — DEBUG, SECRET_KEY handling, ALLOWED_HOSTS and forwarded headers, proxy HTTPS detection, cookie flags, HSTS, CSRF_TRUSTED_ORIGINS and 6.0 CSP nonces.
priority: 72
tags: [CWE-16, CWE-200, CWE-614, A02:2025]
activation:
  files: ["**/settings.py", "**/settings/*.py", "**/settings_*.py"]
  content:
    - '^[ \t]*(?:DEBUG|SECRET_KEY|SECRET_KEY_FALLBACKS|ALLOWED_HOSTS|USE_X_FORWARDED_HOST|USE_X_FORWARDED_PORT|CSRF_TRUSTED_ORIGINS|PASSWORD_HASHERS)\s*='
    - '^[ \t]*(?:SECURE|SESSION_COOKIE|CSRF_COOKIE)_\w+\s*='
    - '\bcsp_nonce\b|\bCSP\.NONCE\b'
sources:
  - https://docs.djangoproject.com/en/stable/howto/deployment/checklist/
  - https://docs.djangoproject.com/en/stable/ref/settings/#secure-proxy-ssl-header
  - https://docs.djangoproject.com/en/stable/topics/security/
  - https://docs.djangoproject.com/en/stable/ref/csp/
---
- **DEBUG in production**: `DEBUG = True`, or a default that enables it when the env var is missing → technical 500 pages expose settings, SQL and code. Fix: default `False`.
- **SECRET_KEY exposure**: a literal or committed key (e.g. `django-insecure-…`) lets anyone forge sessions, password-reset tokens and signed values. Fix: load from the environment; rotate via `SECRET_KEY_FALLBACKS`, not by replacing the key.
- **Host trust**: `ALLOWED_HOSTS = ["*"]`, or `USE_X_FORWARDED_HOST = True` without a proxy that overwrites the header → poisoned `build_absolute_uri()` links in password-reset emails.
- **SECURE_PROXY_SSL_HEADER**: set while the proxy passes client-sent `X-Forwarded-Proto` through → spoofed `is_secure()`; missing behind a TLS-terminating proxy → `SECURE_SSL_REDIRECT` loops.
- **Cookie flags**: `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` default to `False` → cookies travel over plain HTTP.
- **HSTS scope**: `SECURE_HSTS_INCLUDE_SUBDOMAINS`/`SECURE_HSTS_PRELOAD` with a long `SECURE_HSTS_SECONDS` breaks any HTTP-only subdomain for the whole max-age. Fix: ramp up after checking subdomains.
- **Broad CSRF_TRUSTED_ORIGINS**: `https://*.example.com` trusts every subdomain, including user-controlled ones; `http://` origins allow downgrade.
- **CSP nonces (6.0+)**: `CSP.NONCE` needs the `csp` context processor and `nonce="{{ csp_nonce }}"`; full-page caching reuses nonces; `SECURE_CSP_REPORT_ONLY` alone blocks nothing.
