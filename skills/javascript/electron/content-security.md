---
name: CSP and script injection in Electron
description: Electron renderer hardening defects — missing CSP, onHeadersReceived filters that stopped matching in Electron 35, stripped frame/CSP headers on third-party sites, executeJavaScript/insertCSS injection and dev-only unsafe-eval shipped to production.
priority: 72
tags: [CWE-79, CWE-94, CWE-1021]
activation:
  content:
    - 'Content-Security-Policy|\bonHeadersReceived\b|\bwebRequest\.'
    - '\b(?:executeJavaScript|executeJavaScriptInIsolatedWorld|insertCSS)\('
    - '\bunsafe-eval\b|X-Frame-Options'
  examples:
    - 'session.webRequest.onHeadersReceived((details, callback) => { callback(details); });'
    - "await webContents.executeJavaScript(`document.title = '${title}'`);"
    - "script-src 'self' 'unsafe-eval';"
sources:
  - https://www.electronjs.org/docs/latest/tutorial/security
  - https://www.electronjs.org/docs/latest/breaking-changes
  - https://www.electronjs.org/docs/latest/api/web-request
---
- **No CSP**: renderer HTML without a CSP `<meta>` or a header injected via `session.webRequest.onHeadersReceived` → injected markup runs scripts with bridge access. Fix: `script-src 'self'`, no `unsafe-inline`/`unsafe-eval`.
- **Empty URL filter (35+)**: `onHeadersReceived({ urls: [] }, …)` used to match all URLs; since Electron 35 it doesn't → CSP/header injection silently stops. Fix: `{ urls: ['<all_urls>'] }` or omit the filter.
- **Stripping protections**: deleting `X-Frame-Options`/`Content-Security-Policy` from third-party responses to embed their sites → those sites become framable and scriptable in your app's session. Fix: separate partition, don't strip headers.
- **executeJavaScript injection**: code strings for `webContents.executeJavaScript`/`insertCSS` built by concatenating or interpolating renderer, remote or user data → code runs with page privileges. Fix: pass data via IPC or embed `JSON.stringify(data)`.
- **Dev CSP in production**: `unsafe-eval` added for bundler dev builds (eval source maps) and left in packaged builds → eval-based XSS. Fix: build-mode-specific CSP.
