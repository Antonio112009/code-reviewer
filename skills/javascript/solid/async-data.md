---
name: Resources and async data
description: SolidJS async data defects — errored resources throwing on read, Suspense fallbacks on every refetch, Solid Router query cache-key collisions, mutations that skip or over-trigger revalidation, and client re-fetching after SSR.
priority: 60
activation:
  content:
    - "\\bcreate(?:Resource|Async|AsyncStore)\\s*[(<]"
    - "(?<![.\\w$])(?:query|cache)\\s*\\(\\s*async\\b"
    - "\\b(?:useTransition|startTransition|refetch|revalidate)\\s*\\("
    - "<(?:Suspense|ErrorBoundary)\\b"
  examples:
    - "const [user] = createResource(userId, fetchUser);"
    - "const getUser = query(async (id) => db.user.findUnique({ where: { id } }), 'getUser');"
    - "refetch();"
    - "<Suspense fallback={<Spinner />}>{children}</Suspense>"
  versions: { framework.solid: "<2" }
sources:
  - https://docs.solidjs.com/reference/basic-reactivity/create-resource
  - https://docs.solidjs.com/solid-router/reference/data-apis/query
  - https://docs.solidjs.com/solid-router/reference/response-helpers/json
  - https://docs.solidjs.com/guides/fetching-data
---
- **Errored read throws**: calling `data()` when the resource or `createAsync` value errored throws → the nearest `<ErrorBoundary>` (or the whole app) replaces the UI. Fix: check `data.error`/`data.state` first, or add a local boundary.
- **Suspense flicker**: refetches and source changes re-suspend → the fallback replaces content again. Fix: read `data.latest`, or wrap updates in `startTransition`/`useTransition`.
- **Query key collisions**: two `query()` functions sharing a name, or arguments that don't `JSON.stringify` stably (class instances, functions, Dates) → shared or broken cache entries. Fix: unique names; plain serializable arguments.
- **Mutations outside actions**: calling a mutating server function directly instead of through `action`/`useAction` → no revalidation, stale queries; actions without a key revalidate every active query → extra requests. Fix: mutate via actions returning `json(data, { revalidate: [key] })`.
- **Client re-fetch after SSR**: `createResource` with `ssrLoadFrom: 'initial'` or client-only sources → data fetched again after hydration. Fix: default server hydration; `deferStream` for data needed in head/meta.
