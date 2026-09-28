---
name: Third-party scripts
description: Performance cost of third-party code — parser-blocking vendor scripts, eagerly loaded widgets and embeds, anti-flicker snippets, analytics re-injected on SPA navigations and preconnect overuse.
priority: 48
activation:
  content:
    - '<script\b[^>\n]{0,200}\bsrc\s*=\s*[''"](?:https?:)?//'
    - '\bcreateElement\(\s*[''"]script[''"]|\bdocument\.write\('
    - '\b(?:googletagmanager|gtag|dataLayer|fbq|hotjar|intercom|hubspot|optimizely|segment)\b|next/script|<Script\b'
    - 'rel\s*=\s*[''"](?:preconnect|dns-prefetch)|<iframe\b[^>\n]{0,200}(?:youtube|vimeo|maps\.google)'
  examples:
    - '<script src="https://widget.example.com/chat.js"></script>'
    - "const s = document.createElement('script');"
    - 'window.dataLayer = window.dataLayer || [];'
    - '<link rel="preconnect" href="https://fonts.gstatic.com" />'
sources:
  - https://web.dev/articles/efficiently-load-third-party-javascript
  - https://developer.chrome.com/docs/lighthouse/performance/third-party-facades
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script
---
- **Parser-blocking vendors**: third-party `<script src>` in `<head>` without `async`/`defer`, or injected with `document.write` → rendering waits on another origin; a slow or down vendor blanks the page. Fix: `defer`/`async`, load after main content.
- **Eager widgets and embeds**: chat, video, maps and social embeds, heatmaps loaded on every page at startup → main-thread work hurts LCP and INP. Fix: facades (click-to-load), load on idle or interaction.
- **Anti-flicker snippets**: A/B-testing snippets that hide the page until the tool loads → blank page until timeout on slow networks. Fix: short timeouts, server-side experiments.
- **Re-injected on navigation**: SPAs inserting analytics or pixel scripts again on each route change → duplicate execution, memory growth, double-counted events. Fix: load once; send page views through the API.
- **Preconnect overuse**: `preconnect` to many origins or to origins not used early → sockets and TLS work competing with critical requests. Fix: preconnect only 1–3 critical origins; `dns-prefetch` for the rest.
