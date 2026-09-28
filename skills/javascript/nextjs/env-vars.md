---
name: Environment variables in Next.js
description: Next.js env var defects — secrets behind NEXT_PUBLIC_, server-only vars read in Client Components, dynamic process.env access that is never inlined, NEXT_PUBLIC_ values frozen at build, server env evaluated during prerender and .env loading rules.
priority: 66
tags: [CWE-200, CWE-540]
activation:
  content:
    - "\\bprocess\\.env\\b"
    - "\\bNEXT_PUBLIC_\\w+"
    - "\\bloadEnvConfig\\s*\\("
  examples:
    - "const apiUrl = process.env.NEXT_PUBLIC_API_URL;"
    - "loadEnvConfig(process.cwd());"
sources:
  - https://nextjs.org/docs/app/guides/environment-variables
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/env
  - https://nextjs.org/docs/app/guides/data-security
---
- **Secrets made public**: API keys, DB URLs or signing secrets named `NEXT_PUBLIC_*` → inlined into the JavaScript sent to every visitor. Fix: drop the prefix and use them only in server code.
- **Server vars in client code**: non-public `process.env.X` read in `'use client'` modules is defined during SSR but `undefined` in the browser → hydration mismatches and broken client logic. Fix: read on the server, pass as props.
- **Dynamic access not inlined**: `process.env[name]` or `const { NEXT_PUBLIC_X } = process.env` is not replaced at build → `undefined` in the browser. Fix: literal `process.env.NEXT_PUBLIC_X`.
- **Frozen at build**: `NEXT_PUBLIC_*` values are baked in by `next build` → one Docker image promoted from staging to production keeps staging URLs and keys. Fix: per-environment builds or runtime config served by the server.
- **Prerendered server env**: `process.env` read in a statically prerendered page is evaluated at build, so runtime values are ignored. Fix: `await connection()` before reading.
- **Loading rules**: `.env.local` is skipped when `NODE_ENV=test`, `.env*` files load only from the project root (not `src/`), and `$` in values expands other variables unless escaped as `\$`.
