---
name: Cookies and web storage
description: Browser-side credential storage defects — tokens in localStorage/sessionStorage/IndexedDB, session cookies written from JavaScript, reliance on default SameSite, SameSite=None and third-party cookie blocking, Domain widening, partitioned third-party storage and data left after logout.
priority: 72
tags: [CWE-922, CWE-1004, CWE-352, CWE-614]
activation:
  content:
    - '\bdocument\.cookie\b|\bcookieStore\b|js-cookie|\bCookies\.set\('
    - '\b(?:localStorage|sessionStorage|indexedDB)\b'
    - 'Set-Cookie|\bSameSite=|__Host-|__Secure-|\bPartitioned\b|\bClear-Site-Data\b|\brequestStorageAccess\b'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
  - https://caniuse.com/mdn-http_headers_set-cookie_samesite_lax_default
  - https://privacysandbox.google.com/3pcd/storage-partitioning
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data
---
- **Tokens in web storage**: access/refresh tokens, session ids or PII in `localStorage`, `sessionStorage` or IndexedDB → any XSS or third-party script exfiltrates them. Fix: `HttpOnly` session cookies; short-lived access tokens in memory.
- **Session cookies from JS**: auth cookies written via `document.cookie`, `js-cookie` or `cookieStore` → never `HttpOnly`, often no `Secure`/`SameSite`. Fix: set them server-side.
- **Relying on default SameSite**: omitting `SameSite` and assuming `Lax` → only Chromium defaults to Lax; Firefox and Safari send it cross-site → CSRF. Fix: explicit `SameSite=Lax|Strict` plus CSRF tokens.
- **`SameSite=None` pitfalls**: without `Secure` → rejected; in iframes/widgets Safari and Firefox block or partition third-party cookies → logins inside embeds fail. Fix: `Secure`, `Partitioned` (CHIPS) or the Storage Access API.
- **Scope widening**: `Domain=example.com` shares cookies with every subdomain (user content, legacy hosts) → theft or fixation. Fix: host-only cookies with the `__Host-` prefix (`Secure`, `Path=/`, no `Domain`).
- **Partitioned storage**: cross-site iframe widgets expecting `localStorage`, IndexedDB or BroadcastChannel shared with their own top-level site (partitioned since Chrome 115) → state missing, repeated logins. Fix: design for partitioning or `requestStorageAccess()`.
- **Logout leftovers**: logout ends the server session but leaves tokens, PII or cached API responses in storage/Cache Storage → the next user of the device sees them. Fix: clear them; `Clear-Site-Data`.
