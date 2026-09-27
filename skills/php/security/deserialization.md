---
name: Unserialize and object injection
description: unserialize() on attacker-reachable data, weak allowed_classes use, phar:// metadata deserialization before PHP 8.0, and gadget-prone magic methods in application classes.
priority: 80
tags: [CWE-502, OWASP-A08]
activation:
  content:
    - '\b(?:unserialize|igbinary_unserialize|msgpack_unpack)\s*\('
    - '\ballowed_classes\b|phar://'
    - '\bfunction\s+__(?:wakeup|unserialize|destruct|toString)\s*\('
sources:
  - https://www.php.net/manual/en/function.unserialize.php
  - https://www.php.net/manual/en/migration80.incompatible.php
  - https://owasp.org/www-community/vulnerabilities/PHP_Object_Injection
---
- **Untrusted input**: `unserialize()` on cookies, request data, uploaded files, or cache/queue/DB values another party can write (unauthenticated Redis, shared memcached) → POP gadget chains from vendor code give RCE or file writes. Fix: `json_decode()`.
- **allowed_classes is not a MAC**: `['allowed_classes' => false]` blocks objects but still allows deep nesting (set `max_depth`); allowing listed classes still runs their magic methods. Fix: HMAC-sign stored payloads and verify with `hash_equals()` before decoding.
- **Leaked signing keys**: frameworks decrypt or verify, then unserialize cookies, sessions and cache entries → a leaked app key or secret is RCE, not just forgery. Fix: rotate keys, prefer JSON serializers.
- **phar:// (PHP < 8.0)**: `file_exists`, `is_file`, `fopen`, `getimagesize` on attacker-influenced paths with `phar://` unserialize archive metadata → uploaded "images" become RCE. Fix: reject wrappers; PHP 8.0 stopped auto-unserializing.
- **Gadget-friendly classes**: `__wakeup`, `__unserialize`, `__destruct` or `__toString` that delete files, run queries or shell out turn your classes into gadgets; restored objects skip constructors and property-hook validation. Fix: keep them side-effect free, revalidate state.
