---
name: Async request APIs (Next.js 15+)
description: Next.js 15/16 async request-time APIs — synchronous access to params, searchParams, cookies(), headers() and draftMode() (deprecated in 15, removed in 16), destructuring in signatures and Promise ids in image and sitemap functions.
priority: 64
activation:
  content:
    - "(?<![.\\w$])(?:params|searchParams)\\s*[:.]"
    - "\\{\\s*params\\s*[},]"
    - "\\b(?:cookies|headers|draftMode)\\s*\\(\\s*\\)\\s*\\."
    - "\\bUnsafeUnwrapped\\w+"
    - "\\bgenerate(?:Sitemaps|ImageMetadata)\\b"
  versions: { framework.nextjs: ">=15" }
sources:
  - https://nextjs.org/docs/app/guides/upgrading/version-15
  - https://nextjs.org/docs/app/guides/upgrading/version-16
  - https://nextjs.org/docs/app/api-reference/file-conventions/page
---
- **Sync params access**: `params.id` or `searchParams.q` without `await` (or `use()` in Client Components) — deprecated in 15, removed in 16 → `undefined` values: queries by `undefined`, filters silently dropped. Fix: `const { id } = await params`.
- **Destructuring in the signature**: `({ params: { id } })` reads a property of a Promise → `undefined` on 16. Fix: await inside the body.
- **Sync cookies()/headers()/draftMode()**: `cookies().get('t')` without `await` works with a warning on 15 and throws on 16; `UnsafeUnwrapped*` casts left by the codemod break on upgrade. Fix: `(await cookies()).get('t')`.
- **Image and sitemap ids (16)**: in `opengraph-image`, `icon` and `sitemap` functions `params` and the `id` from `generateImageMetadata`/`generateSitemaps` are Promises (`id` becomes a string) → `id * 50000` yields NaN. Fix: `Number(await id)`.
