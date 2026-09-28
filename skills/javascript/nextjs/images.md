---
tier: full
name: next/image and image optimization
description: next/image and images config defects — permissive remotePatterns, redirects that bypass allowlists, SVG without attachment and CSP, Next.js 16 default changes, an optimizer cache that cannot be purged and auth-protected sources.
priority: 60
tags: [CWE-918, CWE-79, CWE-400]
activation:
  content:
    - "['\"]next/(?:legacy/)?image['\"]"
    - "<Image\\b"
    - "\\b(?:remotePatterns|localPatterns|dangerouslyAllowSVG|dangerouslyAllowLocalIP|minimumCacheTTL)\\b"
  examples:
    - "import Image from 'next/image';"
    - "<Image src={photo.url} alt={photo.alt} width={800} height={600} />"
    - "remotePatterns: [{ hostname: '**' }],"
sources:
  - https://nextjs.org/docs/app/api-reference/components/image
  - https://nextjs.org/docs/app/guides/upgrading/version-16
  - https://nextjs.org/blog/august-2026-security-release
---
- **Permissive remotePatterns**: `hostname: '**'`, broad wildcards or omitted `protocol`/`pathname`/`search` (omitted means `**`) → your server optimizes anyone's images: CPU cost and exposure to image-parser CVEs (AVIF RCE mitigated in 16.3.3/15.5.24). Fix: exact hosts and paths.
- **Redirects bypass allowlists**: allowed hosts that redirect are followed without re-checking `remotePatterns` (up to 3 hops by default since 16). Fix: `maximumRedirects: 0` for untrusted hosts; keep `dangerouslyAllowLocalIP` off.
- **SVG optimization**: `dangerouslyAllowSVG: true` without `contentDispositionType: 'attachment'` (default since 15) and a restrictive `contentSecurityPolicy` → stored XSS through SVGs. Fix: keep both, or `unoptimized` for trusted SVGs.
- **Next.js 16 defaults**: `quality` values outside `images.qualities` (default `[75]`) are coerced; local `src` with a query string needs `localPatterns.search` (otherwise 400); `priority` is deprecated for `preload`.
- **Unpurgeable cache**: optimized images are cached for max(`minimumCacheTTL`, upstream max-age) — at least 4 h since 16 — with no purge → a file replaced at the same URL keeps its old image. Fix: versioned URLs.
- **Auth-protected sources**: the optimizer forwards no cookies or headers → private images fail. Fix: `unoptimized` or signed URLs.
