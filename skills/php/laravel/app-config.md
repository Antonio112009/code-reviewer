---
name: Environment, keys and middleware configuration
description: Laravel app configuration — env() after config:cache, APP_DEBUG in production, APP_KEY leaks and rotation, PHP-serialized cache and sessions, trustProxies('*'), broad CSRF exceptions and signed routes without the signed middleware.
priority: 70
tags: [CWE-489, CWE-321, CWE-502, CWE-352, CWE-348]
activation:
  files: ["**/config/*.php", "**/bootstrap/app.php", "**/.env", "**/.env.*"]
  content:
    - '\benv\s*\(\s*[''"]|\bAPP_(?:DEBUG|KEY|PREVIOUS_KEYS)\b'
    - '->trustProxies\s*\(|\$proxies\b|->validateCsrfTokens\s*\(|->preventRequestForgery\s*\(|\$except\b'
    - '\b(?:encrypt|decrypt)\s*\(|\bURL::(?:signedRoute|temporarySignedRoute)\s*\(|\bserializable_classes\b'
sources:
  - https://laravel.com/docs/13.x/configuration#configuration-caching
  - https://laravel.com/docs/13.x/encryption
  - https://laravel.com/docs/13.x/requests#configuring-trusted-proxies
  - https://laravel.com/docs/13.x/upgrade
---
- **env() outside config**: after `php artisan config:cache` the `.env` file is not loaded, so `env()` in application code returns `null` or the default → production-only failures. Fix: call `env()` only in `config/*.php`, read via `config()`.
- **APP_DEBUG in production**: `APP_DEBUG=true` renders stack traces, queries and environment values (DB passwords, API keys) on error pages.
- **APP_KEY**: `encrypt()`/`decrypt()` serialize by default, and cookies and sessions are encrypted with the key → a leaked key means forged sessions and deserialization RCE; changing it logs everyone out and breaks encrypted columns. Fix: `encryptString()`, rotate via `APP_PREVIOUS_KEYS` (11+).
- **PHP-serialized cache and sessions**: cache values and `php`-serialized sessions are unserialized on read → a writable cache store or leaked key gives RCE. Laravel 13 skeletons set `serializable_classes => false` and session `json`; upgraded apps keep the old config.
- **Trusted proxies**: `$middleware->trustProxies(at: '*')` or `$proxies = '*'` on a server reachable without a proxy → spoofed `X-Forwarded-For/Proto/Host` corrupt `$request->ip()` rate limits, audit logs and generated URLs. Fix: proxy CIDRs.
- **CSRF exceptions**: wildcards such as `validateCsrfTokens(except: ['api/*'])` or `$except` covering session-authenticated routes → cross-site requests succeed. Fix: exclude only signed webhooks.
- **Signed URLs**: routes linked with `URL::signedRoute()`/`temporarySignedRoute()` but lacking the `signed` middleware or a `hasValidSignature()` check accept any parameters.
