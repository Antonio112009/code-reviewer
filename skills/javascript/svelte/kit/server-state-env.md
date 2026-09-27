---
name: Server state, env and page state
description: SvelteKit shared-state and environment defects — module-level server state leaking between users, static vs dynamic and public vs private env misuse, stale values on reused pages, $app/state in legacy code and prerendered personal pages.
priority: 64
activation:
  files: ["**/lib/server/**", "**/*.server.{js,ts}"]
  content:
    - "from ['\"]\\$env/(?:static|dynamic)/(?:public|private)['\"]"
    - "from ['\"]\\$app/(?:stores|state|environment|navigation)['\"]"
    - "\\bPUBLIC_[A-Z0-9_]+"
    - "\\bexport\\s+const\\s+(?:prerender|ssr|csr)\\b"
sources:
  - https://svelte.dev/docs/kit/state-management
  - https://svelte.dev/docs/kit/$env-static-private
  - https://svelte.dev/docs/kit/$app-state
  - https://svelte.dev/docs/kit/migrating-to-sveltekit-2
---
- **Module state on the server**: `let currentUser`, caches, stores or `$state` at module level in server code or shared `.svelte.ts` modules, written during a request → visible to other users. Fix: `event.locals`, `setContext`, or the DB/session.
- **Static vs dynamic env**: `$env/static/*` is inlined at build → rotating secrets or per-environment values at runtime has no effect; `$env/dynamic/*` can't be read while prerendering (Kit 2). Fix: dynamic env for runtime config; static for build constants.
- **PUBLIC_ exposure**: secrets named with the `PUBLIC_` prefix, or private env re-exported from a shared module → shipped to the browser. Fix: private env only in `$lib/server` or `*.server.ts`.
- **Reused page components**: navigating `/items/1` → `/items/2` keeps the component mounted → values computed once from `data` or params at init stay stale. Fix: `$derived(data.item)` or reactive reads.
- **$app/state in legacy code**: `page` from `$app/state` (2.12+) is reactive only with runes; in `$:` statements it never updates. Fix: runes, or `$app/stores` in legacy components.
- **Prerendered personal pages**: `export const prerender = true` on routes that read cookies, the session or query params → build-time output served to everyone. Fix: prerender public pages only.
