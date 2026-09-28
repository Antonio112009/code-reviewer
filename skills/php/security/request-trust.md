---
name: Trusting request metadata
description: Client-controlled request data treated as trusted — Host header in generated links, X-Forwarded-For/Proto without a trusted proxy, $_REQUEST and cookie precedence, extract()/parse_str into scope, redirects without exit and open redirects.
priority: 74
tags: [CWE-290, CWE-601, CWE-621, CWE-698]
activation:
  content:
    - '\$_SERVER\[\s*[''"](?:HTTP_HOST|SERVER_NAME|HTTP_X_FORWARDED_\w+|HTTP_CLIENT_IP|REMOTE_ADDR|HTTPS)'
    - '\$_REQUEST\b|\bextract\s*\(|\bparse_str\s*\('
    - '\bheader\s*\(\s*[''"]Location\s*:'
  examples:
    - '$host = $_SERVER[''HTTP_HOST''];'
    - 'extract($_POST);'
    - 'header(''Location: '' . $next);'
sources:
  - https://www.php.net/manual/en/reserved.variables.server.php
  - https://www.php.net/manual/en/function.extract.php
  - https://www.php.net/manual/en/ini.core.php
  - https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
---
- **Host header**: absolute URLs for password resets, e-mail links or redirects built from `HTTP_HOST` (or `SERVER_NAME` with `UseCanonicalName Off`) → reset tokens mailed as links to an attacker's domain. Fix: a configured base URL.
- **Forwarded headers**: `HTTP_X_FORWARDED_FOR`, `HTTP_CLIENT_IP` or `X-Forwarded-Proto` read without a trusted-proxy check → spoofed IPs defeat rate limits, allowlists and audit logs; spoofed scheme drops `Secure` handling. Fix: trust them only from known proxy addresses.
- **$_REQUEST**: merges GET, POST and (depending on `request_order`/`variables_order`) cookies → a cookie or query value silently overrides the POST field a check validated. Fix: read the specific superglobal.
- **extract() / parse_str()**: `extract($_POST)` or `extract($row)` overwrites local variables such as `$isAdmin` or `$path`. Fix: explicit assignments, `EXTR_SKIP` at minimum; `parse_str()` needs its result array (required since 8.0).
- **Redirect without exit**: `header('Location: …')` does not stop the script → code after an access-denied redirect still runs and renders data. Fix: `exit;` after the header.
- **Open redirect**: redirecting to `$_GET['next']` accepts `https://evil`, `//evil` and `/\evil` → phishing and OAuth code leaks. Fix: allow only relative paths starting with a single `/`, or an allowlist.
