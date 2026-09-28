---
name: Outbound HTTP, cURL and URL validation
description: SSRF and transport traps — permissive FILTER_VALIDATE_URL, parse_url vs cURL/Guzzle parser differentials (Uri classes in 8.5), cURL protocols, redirects and DNS rebinding, URL-fetching file functions, disabled TLS checks and missing timeouts.
priority: 76
tags: [CWE-918, CWE-295, CWE-400]
activation:
  content:
    - '\bcurl_(?:init|setopt|setopt_array|exec)\s*\(|\bCURLOPT_\w+'
    - '\bFILTER_VALIDATE_URL\b|\bparse_url\s*\(|\bUri\\(?:Rfc3986|WhatWg)\\'
    - '\bGuzzleHttp\\|\ballow_redirects\b|[''"]verify[''"]\s*=>\s*false'
    - '\b(?:file_get_contents|get_headers|simplexml_load_file)\s*\(\s*\$'
  examples:
    - '$ch = curl_init($url); curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);'
    - '$host = parse_url($url, PHP_URL_HOST);'
    - 'new GuzzleHttp\Client([''allow_redirects'' => true]);'
    - '$html = file_get_contents($url);'
sources:
  - https://www.php.net/manual/en/filter.constants.php
  - https://www.php.net/manual/en/function.parse-url.php
  - https://www.php.net/manual/en/curl.constants.php
  - https://docs.guzzlephp.org/en/stable/request-options.html
---
- **FILTER_VALIDATE_URL is permissive**: it accepts `javascript://x%0aalert(1)`, `gopher://`, `phar://` and loopback hosts → not an SSRF or XSS filter. Fix: allowlist scheme and host after parsing.
- **Parser differential**: checking the host with `parse_url()` but fetching with cURL/Guzzle → `user@host`, backslash and encoding tricks bypass host allowlists. Fix: one parser end to end (`Uri\WhatWg\Url` in 8.5), pin the IP via `CURLOPT_RESOLVE`.
- **Protocols**: cURL accepts every compiled-in protocol (`file`, `gopher`, `dict`, `ldap`) by default. Fix: `CURLOPT_PROTOCOLS_STR` and `CURLOPT_REDIR_PROTOCOLS_STR` set to `'https'` (PHP 8.3+, libcurl 7.85+).
- **Redirects and DNS**: `CURLOPT_FOLLOWLOCATION`, Guzzle `allow_redirects` (on by default) and the `http://` stream wrapper follow redirects without re-running your checks; DNS can change between check and fetch → internal hosts and 169.254.169.254 reachable. Fix: validate every hop, block private ranges.
- **URL-fetching file functions**: `file_get_contents($url)`, `get_headers()`, `simplexml_load_file()` on user URLs fetch remotely (and accept `php://`) with only `default_socket_timeout` → SSRF, stuck workers.
- **TLS off, no timeout**: `CURLOPT_SSL_VERIFYPEER => false`, Guzzle `'verify' => false` or stream `verify_peer => false` → MITM; cURL's `CURLOPT_TIMEOUT` defaults to 0 (never) → a slow upstream pins PHP-FPM workers.
