---
name: Config, sessions and deployment
description: Flask configuration defects — readable client-side sessions valid for 31 days, weak or committed SECRET_KEY, key rotation bug in 3.1.0, insecure cookie defaults, debug mode and the Werkzeug console, ProxyFix hop counts and Host-derived external URLs.
priority: 70
tags: [CWE-565, CWE-613, CWE-94, CWE-348, A02:2025]
activation:
  content:
    - '\b(?:SECRET_KEY|SECRET_KEY_FALLBACKS|SESSION_COOKIE_\w+|PERMANENT_SESSION_LIFETIME|SERVER_NAME|TRUSTED_HOSTS|PREFERRED_URL_SCHEME|FLASK_DEBUG|FLASK_ENV)\b'
    - '\bsession\[|\bsession\.(?:get|permanent|clear|pop)\b'
    - '\.run\([^)\n]{0,80}\bdebug\s*=|\buse_debugger\b|\bProxyFix\('
    - '\burl_for\([^)\n]{0,120}_external\s*=\s*True'
sources:
  - https://flask.palletsprojects.com/en/stable/config/
  - https://flask.palletsprojects.com/en/stable/web-security/
  - https://flask.palletsprojects.com/en/stable/deploying/proxy_fix/
  - https://flask.palletsprojects.com/en/stable/changes/
---
- **Client-side session**: the default `session` is a signed, not encrypted, cookie → clients read everything stored in it (tokens, PII, internal flags). Fix: keep only ids, or server-side sessions.
- **Sessions cannot be revoked**: `session.clear()` only drops the browser's copy; a copied cookie keeps working until the signature age exceeds `PERMANENT_SESSION_LIFETIME` (31 days by default, even for non-permanent sessions). Fix: server-side sessions or a short lifetime.
- **SECRET_KEY**: a literal, default or committed key lets anyone forge sessions and itsdangerous tokens. Fix: load from the environment; rotate with `SECRET_KEY_FALLBACKS` (3.1+), which signed with a stale key in 3.1.0 (fixed in 3.1.1).
- **Cookie defaults**: `SESSION_COOKIE_SECURE = False` and `SESSION_COOKIE_SAMESITE = None` → cookies sent over HTTP and cross-site. Fix: `True`, `"Lax"`.
- **Debug in production**: `app.run(debug=True)` or `FLASK_DEBUG=1` exposes the Werkzeug debugger (remote code execution); `FLASK_ENV` was removed in 2.3 and no longer controls debug.
- **ProxyFix counts**: `ProxyFix(x_for=2, ...)` with fewer real proxies trusts client-supplied `X-Forwarded-*` → spoofed `remote_addr`, scheme and host; no ProxyFix behind a proxy yields `http://` links and the proxy IP.
- **Host-derived links**: `url_for(..., _external=True)` in emails uses the request `Host`; since 3.1 `SERVER_NAME` no longer restricts accepted hosts. Fix: `TRUSTED_HOSTS` (3.1+) or a fixed base URL.
