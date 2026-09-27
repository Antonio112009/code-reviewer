---
name: Layout shifts (CLS)
description: Non-image causes of Cumulative Layout Shift — content injected above existing content, embeds and ads without reserved space, animations of layout properties and skeletons that don't match the final content.
priority: 48
activation:
  content:
    - '@keyframes|\btransition(?:-property)?\s*:|\.animate\('
    - '\b(?:prepend|insertBefore)\(|\binsertAdjacent(?:HTML|Element)\(\s*[''"](?:beforebegin|afterbegin)'
    - '<(?:iframe|embed|object)\b|\b(?:adsbygoogle|googletag|ad-?slot|[Bb]anner|[Ss]keleton)\b'
sources:
  - https://web.dev/articles/optimize-cls
  - https://web.dev/articles/cls
---
- **Content injected above**: banners, cookie notices, promo bars or late API data inserted above visible content (`prepend`, conditional render at the top) → the page jumps. Fix: reserve space, overlay, or insert below (shifts within 500 ms of input don't count).
- **Unreserved embeds and ads**: ad slots, iframes, maps, video embeds and third-party widgets without `min-height`/`aspect-ratio` → shifts when they fill. Fix: reserve the expected size.
- **Layout-property animations**: animating or transitioning `top`, `left`, `width`, `height` or `margin` (or `transition: all`) → layout work every frame and shifts of neighbours. Fix: `transform`/`opacity`.
- **Skeleton mismatch**: loading placeholders with different dimensions than the loaded content → a shift on every load. Fix: size skeletons like the real content.
