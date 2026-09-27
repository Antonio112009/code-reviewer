---
name: next.config risks
description: Risky next.config settings — request-controlled rewrite/redirect hosts, external rewrites acting as proxies, env values inlined into bundles, skipped type checks, public source maps, basePath gaps, standalone output without static assets and headers lost with static export.
priority: 62
tags: [CWE-918, CWE-601, CWE-540]
activation:
  files: ["**/next.config.{js,mjs,cjs,ts,mts}"]
sources:
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites
  - https://nextjs.org/blog/july-2026-security-release
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/env
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/output
---
- **Request-controlled destination host**: `rewrites()`/`redirects()` whose destination hostname contains a param (`https://:tenant.example.com/:path*`) → SSRF or open redirect to any host (CVE-2026-64645 bypassed suffix checks). Fix: fixed hosts per rule.
- **External rewrites as proxies**: rewriting broad paths to another origin forwards users' cookies and headers there. Fix: narrow paths or a Route Handler that strips credentials.
- **env inlining**: values in the legacy `env` key are always inlined into client bundles, `NEXT_PUBLIC_` prefix or not → secrets shipped to browsers.
- **Skipped checks**: `typescript.ignoreBuildErrors` (and `eslint.ignoreDuringBuilds` before 16; 16 no longer lints during build) → type and lint errors reach production unless CI runs them.
- **Public source maps**: `productionBrowserSourceMaps: true` → full client source readable in production.
- **basePath gaps**: `basePath` is added only by `next/link` and the router; `next/image` `src`, raw `fetch('/api/…')`, `<a href>` and CSS asset URLs need the prefix themselves → 404s under the sub-path.
- **Standalone output**: `output: 'standalone'` doesn't copy `public/` or `.next/static` into `.next/standalone` → a Docker image built from it serves the app without JS/CSS/images. Fix: copy both folders or serve them from a CDN.
- **Static export**: with `output: 'export'`, `headers()`, `redirects()`, `rewrites()` and the proxy never run on the static host → CSP/HSTS and redirects silently missing. Fix: configure them at the host or CDN.
