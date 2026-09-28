---
name: postMessage and cross-window messaging
description: Cross-window messaging defects — message handlers without exact origin checks, bypassable origin comparisons and "null" origins, secrets posted to "*", unvalidated message data reaching sinks and missing source checks.
priority: 74
tags: [CWE-346, CWE-79, CWE-201]
activation:
  languages: [html, javascript, typescript, vue, svelte, php, text]
  content:
    - '\bpostMessage\(|\baddEventListener\(\s*[''"]message[''"]|\bonmessage\s*='
    - '\b(?:event|e|evt|msg|message)\.origin\b|\bMessageChannel\b|\bBroadcastChannel\b'
  examples:
    - 'window.addEventListener("message", handleMessage);'
    - 'if (event.origin !== "https://app.example.com") return;'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
  - https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
---
- **No origin check**: `message` listeners acting on `event.data` without comparing `event.origin` to an allowlist → any site that frames or opens yours can drive it. Fix: `if (!ALLOWED.has(event.origin)) return;`.
- **Bypassable checks**: `origin.includes('example.com')`, `indexOf`, `endsWith('example.com')` (matches `evilexample.com`), unanchored or unescaped regexes, or accepting `"null"` (sandboxed iframes, `file:`) → spoofed senders. Fix: exact comparison with full origins.
- **Wildcard target**: `postMessage(tokenOrPII, '*')` to iframes, popups or `window.opener` → leaks to whatever origin that window now shows. Fix: exact `targetOrigin`.
- **Trusting the payload**: after the origin check, `event.data` flows into `innerHTML`, `location`, `eval` or privileged actions without shape validation → XSS via a compromised or user-content page on an allowed origin. Fix: validate type and fields.
- **No source check**: several frames share an allowed origin (user embeds, widgets on a CDN) → messages accepted from the wrong one. Fix: compare `event.source` with the expected window.
