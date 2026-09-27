---
name: Framing and clickjacking
description: Frame-related defects — pages without frame-ancestors/X-Frame-Options, ineffective settings (ALLOW-FROM, meta tags, JS frame-busting), escapable iframe sandboxes, over-permissive embeds and cross-subdomain code relying on document.domain.
priority: 66
tags: [CWE-1021, CWE-693]
activation:
  content:
    - 'X[-_]Frame[-_]Options|\bframe-ancestors\b|\bframeguard\b|\bxFrameOptions\b|\bframeOptions\b'
    - '<iframe\b|\bsandbox\s*=|\ballow\s*=\s*[''"{][^''"}\n]{0,120}(?:camera|microphone|geolocation|payment)'
    - '\bdocument\.domain\b|Origin-Agent-Cluster|\b(?:top|window\.top)\s*!==?\s*(?:self|window)\b'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
  - https://developer.chrome.com/blog/document-domain-setter-deprecation
---
- **No framing protection**: pages with state-changing actions or sensitive data served without `Content-Security-Policy: frame-ancestors` or `X-Frame-Options` → clickjacking. Fix: `frame-ancestors 'self'` (or an allowlist) plus `X-Frame-Options: DENY|SAMEORIGIN`.
- **Ineffective settings**: `X-Frame-Options: ALLOW-FROM` (ignored by modern browsers), XFO or `frame-ancestors` in `<meta>` (ignored), or JS frame-busting (`if (top !== self)`) that sandboxed frames defeat → no protection. Fix: response headers.
- **Escapable sandbox**: `<iframe sandbox="allow-scripts allow-same-origin">` around same-origin content → the frame can remove its own sandbox. Fix: serve untrusted content from a separate origin; never combine both flags for it.
- **Over-permissive embeds**: third-party iframes with `allow="camera; microphone; geolocation; payment"`, `allow-top-navigation` or `allow-popups-to-escape-sandbox` without need → device access or navigation hijacking. Fix: minimal `sandbox`/`allow`.
- **`document.domain` relaxation**: cross-subdomain frame code setting `document.domain` silently stops working in Chrome 115+ (origin-keyed agent clusters); re-enabling via `Origin-Agent-Cluster: ?0` weakens isolation. Fix: `postMessage`/`MessageChannel`.
