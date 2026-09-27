---
name: CORS, credentials and third-party scripts
description: Cross-origin defects seen from the browser — no-cors used to silence CORS errors, credentials sent to foreign origins, CDN scripts without Subresource Integrity, missing crossorigin attributes, local-network requests from public pages and cross-origin isolation headers breaking embeds or popups.
priority: 68
tags: [CWE-346, CWE-829, CWE-353]
activation:
  content:
    - '\bcredentials\s*:\s*[''"]include|\bwithCredentials\b|\bmode\s*:\s*[''"]no-cors'
    - '\bcross[oO]rigin\b|\bintegrity\s*=|<script\b[^>\n]{0,200}\bsrc\s*=\s*[''"](?:https?:)?//'
    - 'Access-Control-Allow-|Cross-Origin-(?:Opener|Embedder|Resource)-Policy|\btargetAddressSpace\b'
    - '[''"`]https?://(?:localhost|127\.0\.0\.1|192\.168\.|10\.\d)'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
  - https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
  - https://developer.chrome.com/blog/local-network-access
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy
---
- **`no-cors` to silence errors**: `fetch(url, { mode: 'no-cors' })` → opaque response (status 0, unreadable body); code treats it as success or parses nothing. Fix: enable CORS on the server or proxy the call.
- **Credentials to foreign origins**: `credentials: 'include'`/`withCredentials: true` on requests to third-party or configurable hosts → cookies sent cross-site; credentialed responses need an exact `Access-Control-Allow-Origin` (a `*` answer fails). Fix: include credentials only for your API origins.
- **Unpinned CDN scripts**: `<script src="https://cdn…">` without `integrity` + `crossorigin`, or version-less URLs (`@latest`) → a compromised or re-sold CDN domain serves malware to every user (polyfill.io, 2024). Fix: self-host, or SRI with pinned versions.
- **Missing `crossorigin`**: SRI or font/module preloads without matching `crossorigin` → blocked or double-fetched resources; reading cross-origin images in `<canvas>` without CORS → tainted canvas errors. Fix: consistent CORS mode.
- **Local-network calls**: public pages calling `http://localhost`, `127.0.0.1`, `192.168.*` or `.local` devices → Chrome 142+ permission prompt, failures when denied or from insecure contexts. Fix: handle denial; request contextually.
- **Isolation headers**: `Cross-Origin-Embedder-Policy: require-corp` breaks third-party images/iframes without CORP/CORS; `Cross-Origin-Opener-Policy: same-origin` severs `window.opener` for OAuth/payment popups. Fix: `credentialless`, `same-origin-allow-popups`.
