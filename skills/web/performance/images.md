---
tier: full
name: Images and LCP
description: Image defects that hurt LCP, CLS and bandwidth — lazy-loaded or late-discovered hero images, missing dimensions, srcset without sizes, oversized originals and eager off-screen images.
priority: 52
activation:
  content:
    - '<(?:img|picture|source|Image|NuxtImg|NgOptimizedImage)\b|\bngSrc\b'
    - '\bsrc[sS]et\b|\bloading\s*=|\bfetch[pP]riority\b|\bdecoding\s*='
    - '\bbackground(?:-image)?\s*:\s*[^;\n]{0,80}url\(|\bnew Image\('
    - '\bas\s*=\s*[''"]image[''"]'
  examples:
    - '<img src={hero} loading="lazy" />'
    - '.hero { background-image: url("/hero.jpg"); }'
    - '<link rel="preload" as="image" href="/hero.jpg" />'
sources:
  - https://web.dev/articles/optimize-lcp
  - https://web.dev/articles/lcp-lazy-loading
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img
  - https://web.dev/articles/optimize-cls
---
- **Lazy LCP image**: `loading="lazy"` (or a JS lazy-loader/`data-src`) on the hero or other above-the-fold image, often via a component default → LCP waits for layout. Fix: eager plus `fetchpriority="high"` for the LCP image.
- **Late-discovered hero**: hero as a CSS `background-image`, injected by JS, or rendered only after a client-side data fetch → the browser can't start it early. Fix: `<img>` in the initial HTML or `<link rel="preload" as="image" fetchpriority="high">`.
- **Missing dimensions**: `<img>`, `<video>` or `<iframe>` without `width`/`height` or CSS `aspect-ratio` → layout shifts when they load (CLS). Fix: intrinsic size attributes.
- **`srcset` without `sizes`**: width descriptors (`800w`) with no `sizes` → the browser assumes `100vw` and downloads oversized files. Fix: accurate `sizes`, or `sizes="auto"` with `loading="lazy"`.
- **Oversized originals**: full-resolution uploads, PNG photos or GIF animations served at every viewport → megabytes per image. Fix: resized variants, AVIF/WebP, `<video>` instead of GIF.
- **Eager off-screen images**: long pages and galleries loading every image up front → bandwidth stolen from the LCP resource. Fix: `loading="lazy"` below the fold.
