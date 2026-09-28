---
name: Authentication and throttling
description: DRF authentication and rate-limit defects — spoofable throttle identities, per-process throttle caches, SessionAuthentication CSRF gaps, non-expiring plaintext tokens, simplejwt revocation settings and unbounded request bodies before 3.17.2.
priority: 70
tags: [CWE-307, CWE-352, CWE-613, A07:2025]
activation:
  content:
    - '\b(?:authentication_classes|DEFAULT_AUTHENTICATION_CLASSES|SessionAuthentication|TokenAuthentication|BasicAuthentication|JWTAuthentication)\b'
    - '\b(?:throttle_classes|throttle_scope|DEFAULT_THROTTLE_CLASSES|DEFAULT_THROTTLE_RATES|NUM_PROXIES|AnonRateThrottle|UserRateThrottle|ScopedRateThrottle)\b'
    - '\b(?:SIMPLE_JWT|ROTATE_REFRESH_TOKENS|BLACKLIST_AFTER_ROTATION|ACCESS_TOKEN_LIFETIME|REFRESH_TOKEN_LIFETIME|obtain_auth_token)\b'
  examples:
    - 'authentication_classes = [SessionAuthentication, TokenAuthentication]'
    - 'throttle_classes = [UserRateThrottle]'
    - 'SIMPLE_JWT = {"ROTATE_REFRESH_TOKENS": True}'
sources:
  - https://www.django-rest-framework.org/api-guide/throttling/
  - https://www.django-rest-framework.org/api-guide/authentication/
  - https://django-rest-framework-simplejwt.readthedocs.io/en/latest/settings.html
  - https://www.django-rest-framework.org/community/release-notes/
---
- **Spoofable throttle identity**: with `NUM_PROXIES` unset, anonymous throttles key on the whole client-supplied `X-Forwarded-For` → a new value per request bypasses limits. Fix: set `NUM_PROXIES` to the real proxy count.
- **Per-process counters**: throttles use the Django cache; the default `LocMemCache` counts per worker, and updates are non-atomic → limits multiply by worker count. Fix: shared cache; DRF throttling is not brute-force protection.
- **SessionAuthentication CSRF**: CSRF is enforced only for authenticated sessions, so anonymous endpoints like login or signup accept cross-site POSTs (login CSRF). Fix: call `SessionAuthentication().enforce_csrf(request)` there, or keep login in a CSRF-protected Django view.
- **TokenAuthentication tokens**: stored in plaintext, one per user, never expire → a leaked DB row or log line is a permanent credential. Fix: expiring or hashed tokens (e.g. knox), rotation on logout.
- **simplejwt revocation**: `ROTATE_REFRESH_TOKENS = True` without `BLACKLIST_AFTER_ROTATION` and the `token_blacklist` app keeps old refresh tokens valid; access tokens survive logout and password change (`CHECK_REVOKE_TOKEN` is `False`).
- **Basic auth**: `BasicAuthentication` sends reusable passwords on every request and needs HTTPS-only deployment.
- **Unbounded JSON bodies (<3.17.2)**: `request.data` parsing ignored `DATA_UPLOAD_MAX_MEMORY_SIZE` → memory DoS. Fix: upgrade or cap body size at the proxy.
