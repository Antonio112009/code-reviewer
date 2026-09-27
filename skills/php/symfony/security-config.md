---
name: Security and framework configuration
description: Symfony security.yaml and framework settings — access_control and firewall first-match rules, remember-me, user serialization after eraseCredentials removal (8.0), account enumeration, APP_SECRET/APP_DEBUG and trusted proxies.
priority: 72
tags: [CWE-863, CWE-284, CWE-204, CWE-489, CWE-348]
activation:
  files: ["**/config/packages/security.{yaml,yml,php}", "**/config/packages/framework.{yaml,yml,php}", "**/.env", "**/.env.*"]
  content:
    - '\b(?:access_control|firewalls|remember_me|login_throttling|role_hierarchy|switch_user|trusted_proxies|expose_security_errors|hide_user_not_found)\b'
    - '\bAPP_(?:SECRET|DEBUG|ENV)\b|\bfunction\s+(?:eraseCredentials|__serialize)\s*\('
    - '(?:\bpath:\s*|[''"]path[''"]\s*=>\s*)[''"]?\^/'
sources:
  - https://symfony.com/doc/current/security.html
  - https://symfony.com/doc/current/reference/configuration/security.html
  - https://symfony.com/doc/current/deployment/proxies.html
  - https://github.com/symfony/symfony/blob/8.1/UPGRADE-8.0.md
---
- **access_control order**: only the first matching rule applies → `^/api` above `^/api/admin` gives admin routes the weaker role; a path without `^` also matches `/x/admin`. Fix: specific rules first, anchored.
- **Firewall matching**: the first firewall whose `pattern` matches wins → a broadened or unanchored `security: false` pattern (the `dev` firewall) lets real routes skip authentication; a pattern-less firewall listed first shadows later ones.
- **Remember-me**: `IS_AUTHENTICATED_REMEMBERED` accepts remember-me cookies → require `IS_AUTHENTICATED_FULLY` for password or payment changes; dropping `password` from `signature_properties` keeps stolen cookies valid after a reset.
- **User in the session**: the user is serialized into the session; `eraseCredentials()` is deprecated (7.3) and no longer called (8.0) → a `plainPassword` property is stored unless excluded in `__serialize()`.
- **Enumeration and brute force**: `expose_security_errors: all` (or `hide_user_not_found: false`) reveals existing accounts; without `login_throttling` password guessing is unlimited.
- **Impersonation**: `switch_user` with `ROLE_ALLOWED_TO_SWITCH` reachable via `role_hierarchy` from non-admin roles → account takeover.
- **APP_SECRET / APP_DEBUG**: a committed or default `APP_SECRET` lets attackers forge signed URLs, login links and remember-me cookies; `APP_DEBUG=1` in production exposes the profiler with env values.
- **Trusted proxies**: `trusted_proxies` set to `REMOTE_ADDR` or `0.0.0.0/0` while the app is reachable directly → spoofed client IP, host and scheme defeat IP throttling and URL generation.
