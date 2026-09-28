---
name: Request input, remote calls and redirects
description: WordPress data-flow traps — slashed superglobals without wp_unslash, sanitizers that do not fit the type, maybe_unserialize on untrusted data, wp_remote_* errors and status codes, SSRF with user URLs and open redirects.
priority: 70
tags: [CWE-20, CWE-502, CWE-918, CWE-601]
activation:
  content:
    - '\$_(?:GET|POST|REQUEST|COOKIE)\b|\bwp_unslash\s*\(|\bsanitize_\w+\s*\(|\babsint\s*\('
    - '\b(?:maybe_unserialize|unserialize|extract)\s*\('
    - '\bwp_(?:safe_)?remote_(?:get|post|request|head)\s*\(|\bwp_remote_retrieve_\w+\s*\(|\bwp_(?:safe_)?redirect\s*\('
  examples:
    - '$name = sanitize_text_field(wp_unslash($_POST[''name'']));'
    - '$options = maybe_unserialize($meta_value);'
    - '$response = wp_safe_remote_get($url);'
sources:
  - https://developer.wordpress.org/apis/security/sanitizing/
  - https://developer.wordpress.org/reference/functions/wp_unslash/
  - https://developer.wordpress.org/reference/functions/wp_safe_remote_get/
  - https://developer.wordpress.org/reference/functions/wp_safe_redirect/
---
- **Slashed superglobals**: WordPress adds slashes to `$_GET`, `$_POST`, `$_COOKIE` and `$_SERVER` → values stored without `wp_unslash()` gain backslashes (`O\'Brien`) and comparisons fail. Fix: `wp_unslash()`, then sanitize.
- **Sanitizer per type**: `sanitize_text_field()` on IDs, e-mails, URLs or HTML is wrong (and strips newlines from textareas). Fix: `absint()`, `sanitize_email()`, `esc_url_raw()`, `sanitize_key()`, `sanitize_textarea_field()`, `wp_kses_post()`.
- **Object injection**: `maybe_unserialize()`/`unserialize()` on request data, cookies or remote responses → PHP object injection through plugin gadget chains. Fix: JSON.
- **Remote errors**: `wp_remote_get()` returns `WP_Error` on failure and 4xx/5xx are normal responses → `wp_remote_retrieve_body()` yields `''` and bad data flows on. Fix: `is_wp_error()` plus `wp_remote_retrieve_response_code()`.
- **User-supplied URLs**: `wp_remote_get($url)` reaches internal hosts and cloud metadata → use `wp_safe_remote_get()`, which validates the URL and every redirect; never set `'sslverify' => false`.
- **Redirects**: `wp_redirect($_GET['redirect_to'])` is an open redirect and neither function stops execution. Fix: `wp_safe_redirect()` plus `exit`.
