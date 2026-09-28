---
name: Remote functions
description: SvelteKit remote functions (query, form, command, prerender in *.remote.ts; experimental since 2.27, still flagged in the 3.0 RC) — public endpoints without authorization, unchecked arguments, repopulated sensitive fields and misuse of queries versus commands.
category: security
priority: 68
tags: [CWE-862, CWE-20]
activation:
  files: ["**/*.remote.{js,ts}"]
  content:
    - "from ['\"]\\$app/server['\"]"
    - "\\bgetRequestEvent\\s*\\("
    - "\\bremoteFunctions\\b"
    - "\\bquery\\.(?:batch|live)\\s*\\("
  examples:
    - 'import { getRequestEvent } from ''$app/server'';'
    - 'const { locals } = getRequestEvent();'
    - 'kit: { experimental: { remoteFunctions: true } },'
    - 'export const getUsers = query.batch(async (ids) => loadUsers(ids));'
sources:
  - https://svelte.dev/docs/kit/remote-functions
  - https://github.com/sveltejs/kit/security/advisories
  - https://svelte.dev/blog/sveltekit-3-release-candidate
---
- **Public endpoints**: every exported `query`/`form`/`command` is an HTTP endpoint callable by anyone, whatever page imports it → missing auth or ownership checks = IDOR. Fix: `getRequestEvent()` and check `locals.user` inside each function.
- **Unchecked arguments**: `'unchecked'` validation or TypeScript-only types → arbitrary JSON reaches queries and DB writes. Fix: a Standard Schema (Zod, Valibot) for every argument.
- **Sensitive form fields**: `form` fields such as `password` without a leading underscore are sent back for repopulation after validation errors. Fix: name them `_password`.
- **Queries with side effects**: writes or cookie setting inside `query` (cached, re-run on refresh; cookies not allowed) or calling `command` during render (throws) → duplicated or failed writes. Fix: queries read; `command`/`form` write.
- **Build-time data**: `prerender` functions return build-time data, and queries fail on fully prerendered pages → never use them for per-user data. Fix: `query` on dynamic pages.
- **Moving target**: remote functions are experimental with 2026 advisories (form deserialization DoS, `query.batch` cross-talk) → unpatched versions are exploitable. Fix: pin a patched release; follow the changelog.
