---
tier: full
name: Web fonts
description: Web-font loading defects — preloads without crossorigin, invisible text without font-display, swap shifts without metric-matched fallbacks, render-blocking @import chains and oversized font payloads.
priority: 46
activation:
  content:
    - '@font-face|\bfont-display\b|\bas\s*=\s*[''"]font[''"]'
    - 'fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|@import\s+url\('
    - '\.woff2?\b|\.[ot]tf\b|next/font|@fontsource'
sources:
  - https://web.dev/articles/font-best-practices
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload
  - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/font-display
---
- **Preload without `crossorigin`**: `<link rel="preload" as="font">` missing `crossorigin` (required even same-origin) → the font is downloaded twice and the preload is wasted. Fix: add `crossorigin` and `type="font/woff2"`.
- **Invisible text**: `@font-face` without `font-display` (or `block`) → text hidden for up to ~3 s on slow networks, delaying FCP/LCP. Fix: `swap`, or `optional` for body text.
- **Swap shifts**: `font-display: swap` with a fallback of different metrics → reflow when the web font arrives (CLS). Fix: `size-adjust`/`ascent-override` fallback faces or `optional`.
- **Render-blocking chains**: `@import url(https://fonts.googleapis…)` inside CSS or font CSS discovered late → extra round trips before text renders. Fix: `<link>` in `<head>` with `preconnect`, or self-host.
- **Font bloat**: many families/weights, full character sets, TTF/OTF/WOFF instead of WOFF2 → hundreds of KB on the critical path. Fix: subset (`unicode-range`), variable fonts, WOFF2 only.
