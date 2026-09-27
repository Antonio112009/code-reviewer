---
name: XSS in plain PHP output
description: Output escaping in PHP templates — raw echo, htmlspecialchars flags before 8.1, wrong context (JS, URLs, unquoted attributes), json_encode inside script tags, strip_tags as a sanitizer and PHP_SELF/REQUEST_URI reflection.
priority: 76
tags: [CWE-79, CWE-116]
activation:
  content:
    - '<\?=|\b(?:echo|print)\s+[^;\n]{0,80}\$'
    - '\b(?:htmlspecialchars|htmlentities|strip_tags)\s*\('
    - '<script\b[^>\n]{0,80}>[^<\n]{0,200}json_encode|\$_SERVER\[\s*[''"](?:PHP_SELF|REQUEST_URI|QUERY_STRING)'
sources:
  - https://www.php.net/manual/en/function.htmlspecialchars.php
  - https://www.php.net/manual/en/migration81.incompatible.php
  - https://www.php.net/manual/en/json.constants.php
  - https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
---
- **Raw echo**: `echo $var` or `<?= $var ?>` with request or database data in HTML → reflected/stored XSS. Fix: `htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')` at output time.
- **Pre-8.1 defaults**: before PHP 8.1 the default flags were `ENT_COMPAT`, so `'` was not escaped → XSS in single-quoted attributes. Fix: always pass `ENT_QUOTES`.
- **Wrong context**: HTML escaping does not protect `href`/`src` (`javascript:` URLs), event handlers, `style`, or unquoted attributes. Fix: scheme allowlist for URLs, quote every attribute, no user data in handlers.
- **JSON in script**: `<script>var d = <?= json_encode($data) ?>;</script>` breaks out with `</script>` in a string. Fix: `JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT`, or a `data-` attribute with `htmlspecialchars`.
- **strip_tags is not a sanitizer**: allowed tags keep their attributes (`<a onclick>`, `<img onerror>`) and it mangles text containing `<`. Fix: HTML Purifier or Symfony HtmlSanitizer for rich text, escaping for plain text.
- **Self URLs**: `$_SERVER['PHP_SELF']`, `REQUEST_URI` or `QUERY_STRING` echoed into form actions or links carry attacker path data (`/index.php/"><script>`) → XSS. Fix: escape, or use fixed route URLs.
