---
name: Loaders (Remix / React Router)
description: Loader defects in Remix v2 and React Router 7–8 framework mode — whole records returned to the client, auth checked only in parent routes, trusted params, cacheable personalized headers, Single Fetch serialization changes, shouldRevalidate returning false and ignored abort signals.
priority: 70
tags: [CWE-200, CWE-639, CWE-862]
activation:
  content:
    - "\\bexport\\s+(?:async\\s+)?function\\s+(?:loader|clientLoader)\\b"
    - "\\bexport\\s+const\\s+loader\\s*="
    - "\\buseLoaderData\\b"
    - "\\bRoute\\.(?:LoaderArgs|ComponentProps)\\b"
sources:
  - https://reactrouter.com/start/framework/data-loading
  - https://v2.remix.run/docs/guides/faq/
  - https://v2.remix.run/docs/guides/single-fetch
  - https://reactrouter.com/start/framework/route-module
---
- **Loader data is public**: everything a loader returns is serialized to the browser, rendered or not → password hashes, tokens and internal fields leak. Fix: return DTOs with only the rendered fields.
- **Auth only in the parent**: loaders run in parallel and a parent loader is not re-run when navigating between its children → child loaders without their own session/ownership checks serve data. Fix: `requireUser(request)` in every loader.
- **Trusted params**: `params.id` or URL search params used to load records without scoping to the session user → IDOR. Fix: filter queries by owner or tenant.
- **Cacheable personalized data**: `headers` exports with `Cache-Control: public` also apply to data requests under Single Fetch → CDNs cache per-user loader data. Fix: `private` on personalized routes.
- **Serialization changes**: Single Fetch (Remix v2 flag, default in React Router 7) streams `Date`, `Map`, `Set` and promises instead of JSON → code expecting strings (`createdAt.slice`) breaks; `json()` and `defer()` are removed in v7. Fix: plain objects, `data()` for status/headers.
- **shouldRevalidate returning false**: skipping revalidation unconditionally → UI stays stale after actions. Fix: return `defaultShouldRevalidate` except for precise cases.
- **Ignored request.signal**: loaders that don't pass `request.signal` to downstream `fetch`/DB calls keep working after navigations abort. Fix: forward the signal.
