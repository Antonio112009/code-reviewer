---
name: TLS verification and URL handling
description: Disabled certificate checks (verify=False, CERT_NONE, _create_unverified_context), hand-built SSLContext, urlopen following file:// and ftp://, urlparse parser differentials, SSRF checks bypassed by DNS/redirects/proxies and credentials leaking over redirects.
priority: 78
tags: [CWE-295, CWE-918, OWASP-A04]
activation:
  content:
    - "\\bverify\\s*=\\s*False\\b|\\bssl\\s*=\\s*False\\b|\\bCERT_NONE\\b|\\bcheck_hostname\\s*=\\s*False\\b|\\b_create_unverified_context\\b|\\bdisable_warnings\\s*\\(|\\bPYTHONHTTPSVERIFY\\b"
    - "\\bssl\\.(?:SSLContext|create_default_context|PROTOCOL_\\w+)\\b"
    - "\\burl(?:open|retrieve)\\s*\\(|\\burl(?:parse|split)\\s*\\("
    - "\\bipaddress\\.ip_(?:address|network)\\s*\\(|\\bis_private\\b|\\ballow_redirects\\s*=|\\bfollow_redirects\\s*=\\s*True\\b|\\btrust_env\\b"
sources:
  - https://docs.python.org/3/library/ssl.html#security-considerations
  - https://docs.python.org/3/library/urllib.request.html#urllib.request.build_opener
  - https://docs.python.org/3/library/urllib.parse.html#url-parsing-security
  - https://requests.readthedocs.io/en/latest/user/advanced/#ssl-cert-verification
---
- **Disabled verification**: `verify=False` (requests/httpx), aiohttp `ssl=False`, `ssl._create_unverified_context()`, `CERT_NONE`, `check_hostname=False` or `PYTHONHTTPSVERIFY=0` → MITM of credentials and data; `urllib3.disable_warnings()` hides it. Fix: keep verification; point `verify=` at a private CA bundle.
- **Hand-built `SSLContext`**: `ssl.SSLContext()` without a protocol (deprecated 3.10) or with server/legacy protocols doesn't check hostnames or certificates by default. Fix: `ssl.create_default_context()` and only add options.
- **`urlopen` schemes**: `urllib.request.urlopen(url)`/`urlretrieve` also open `file://` and `ftp://` URLs → local file disclosure and SSRF from user URLs. Fix: allow only `http`/`https` after parsing.
- **Parser differentials**: `urlparse`/`urlsplit` don't validate; they strip leading control characters (3.12) and treat backslashes and userinfo differently from browsers → allowlist bypass (`https://good.com\@evil.com`). Fix: reject userinfo and backslashes; compare `hostname` exactly.
- **SSRF checks that don't hold**: checking `ipaddress.ip_address(host).is_private` but letting the client re-resolve DNS (rebinding), follow redirects (requests default) or use env proxies (`trust_env`) → internal access. Fix: connect to the checked IP; re-check every redirect hop.
- **Secrets over redirects or HTTP**: API keys or `Authorization` sent to `http://` URLs, or custom redirect handling that forwards auth headers to another host, leak credentials. Fix: enforce https; drop auth on cross-host redirects.
