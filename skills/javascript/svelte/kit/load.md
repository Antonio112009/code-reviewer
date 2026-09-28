---
name: Load functions
description: SvelteKit load defects — secrets in universal load, global fetch instead of the provided one, unawaited streamed promises (Kit 2), waterfalls, over-returned server data, public cache headers on private pages and side effects in load.
priority: 66
activation:
  files: ["**/+page.{js,ts}", "**/+layout.{js,ts}", "**/+page.server.{js,ts}", "**/+layout.server.{js,ts}"]
  content:
    - "\\bexport\\s+(?:const|async\\s+function|function)\\s+load\\b"
    - "\\b(?:PageLoad|PageServerLoad|LayoutLoad|LayoutServerLoad)\\b"
    - "\\b(?:setHeaders|depends|untrack)\\s*\\("
    - "\\bawait\\s+parent\\s*\\(\\s*\\)"
  examples:
    - 'export const load: PageServerLoad = async ({ fetch }) => ({ user: await fetch(''/api/user'') });'
    - 'depends(''app:user'');'
    - 'const { session } = await parent();'
sources:
  - https://svelte.dev/docs/kit/load
  - https://svelte.dev/docs/kit/migrating-to-sveltekit-2
  - https://svelte.dev/docs/kit/state-management
---
- **Secrets in universal load**: `+page.ts`/`+layout.ts` also run in the browser → API keys, admin endpoints or DB access used there are exposed or fail. Fix: move them to `+page.server.ts`.
- **Global fetch**: global `fetch`/axios in load instead of the `fetch` argument → no cookie forwarding on the server, relative URLs fail in SSR, requests repeat during hydration. Fix: use the provided `fetch`.
- **Unawaited promises (Kit 2)**: top-level promises returned from load are no longer awaited → a rejection crashes or leaves `{#await}` hanging. Fix: `await` what must block; `.catch()` promises you stream.
- **Waterfalls**: `await parent()` or sequential awaits before independent requests → serial latency on every navigation. Fix: start independent fetches first; `Promise.all`.
- **Over-returned data**: server load returning whole DB rows or user objects → hashes, tokens and other users' fields serialized into the page even if unrendered. Fix: return minimal DTOs.
- **Public cache on private pages**: `setHeaders({ 'cache-control': 'public, …' })` in loads that read cookies or `locals.user` → CDNs serve one user's page to others. Fix: `private`/`no-store` for personalized responses.
- **Side effects in load**: writing to module variables or global stores inside load → data leaks between users on the server. Fix: return data; per-request state in `event.locals`.
