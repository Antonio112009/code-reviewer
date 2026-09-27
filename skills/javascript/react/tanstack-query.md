---
name: TanStack Query
description: TanStack Query (React Query v4–v5) defects — query keys missing inputs, mutations without invalidation, v5 removed callbacks and renamed options, missing enabled guards, default refetching and QueryClient lifetime.
priority: 58
activation:
  content:
    - "@tanstack/react-query"
    - "\\bquery(?:Key|Fn)\\s*:"
    - "\\buse(?:Suspense)?(?:Infinite)?Query\\s*\\(\\s*\\{"
    - "\\b(?:useMutation|invalidateQueries|setQueryData)\\b"
sources:
  - https://tanstack.com/query/latest/docs/framework/react/guides/query-keys
  - https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5
  - https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
---
- **Incomplete query key**: `queryFn` uses values (ids, filters, page, user/tenant, locale) missing from `queryKey` → another entity's or user's cached data is shown and changes don't refetch. Fix: put every input in the key.
- **No invalidation after mutations**: `useMutation` success without `invalidateQueries`/`setQueryData` for affected keys → stale lists and details. Fix: invalidate in `onSuccess`/`onSettled`.
- **v5 removed query callbacks**: `onSuccess`, `onError` and `onSettled` on `useQuery` were removed in v5 → silently never run (toasts, redirects, syncing lost). Fix: react to `data`/`error`, or `QueryCache` callbacks.
- **v5 renamed options**: `cacheTime`→`gcTime`, `isLoading`→`isPending` (new `isLoading` = pending and fetching), `keepPreviousData`→`placeholderData: keepPreviousData`, `useErrorBoundary`→`throwOnError` → old names ignored, wrong loading UI.
- **Missing enabled guard**: dependent queries without `enabled: !!id` → requests with `undefined` params and junk cached under `[…, undefined]`.
- **Default refetch and retry**: `staleTime: 0` refetches on every mount, focus and reconnect (also right after SSR hydration); 3 retries also hit 401/404 → load spikes, slow error UI. Fix: set `staleTime` and a `retry` predicate.
- **QueryClient in render**: `new QueryClient()` in a component body → a fresh empty cache every render. Fix: module scope in client-only apps, `useState(() => new QueryClient())` with SSR.
