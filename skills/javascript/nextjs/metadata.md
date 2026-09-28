---
tier: full
name: Next.js metadata
description: Metadata API defects — shallow merging that drops nested openGraph/robots fields, relative URLs without metadataBase, title templates on the same segment and deprecated viewport fields.
priority: 52
activation:
  content:
    - "\\bexport\\s+(?:const\\s+metadata|(?:async\\s+)?function\\s+generate(?:Metadata|Viewport))\\b"
    - "\\b(?:metadataBase|openGraph)\\s*:"
  examples:
    - "export const metadata = { title: 'Home', openGraph: { images: ['/og.png'] } };"
    - "export async function generateMetadata({ params }) {"
sources:
  - https://nextjs.org/docs/app/api-reference/functions/generate-metadata
  - https://nextjs.org/docs/app/api-reference/functions/generate-viewport
---
- **Shallow merge drops nested fields**: a child segment setting `openGraph` or `robots` replaces the parent's whole object → lost OG images and descriptions, or a staging `robots: { index: false }` silently undone. Fix: spread shared objects explicitly.
- **Relative URLs without metadataBase**: relative `openGraph.images` or `alternates` URLs without `metadataBase` → build errors, or `localhost` URLs in share cards on older versions. Fix: set `metadataBase` in the root layout.
- **title.template scope**: a template applies only to child segments (not the page of the same segment) and requires `title.default`; a template in `page.tsx` does nothing.
- **Deprecated fields**: `viewport`, `themeColor` and `colorScheme` inside `metadata` (deprecated since 14) → move them to `export const viewport` or `generateViewport`.
