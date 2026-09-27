---
name: Router, guards and resolvers
description: Angular Router defects — client-only guards as security, stale snapshots in reused components, v22 params inheritance, first-value guard semantics, navigation inside guards, lazy chunks and blocking resolvers.
priority: 60
activation:
  content:
    - "\\bCan(?:Activate|ActivateChild|Deactivate|Match)(?:Fn)?\\b"
    - "\\bcan(?:Activate|ActivateChild|Deactivate|Match)\\s*:"
    - "\\b(?:ResolveFn|RedirectCommand|ActivatedRoute|provideRouter|withComponentInputBinding|withRouterConfig)\\b"
    - "\\bparamsInheritanceStrategy\\b"
    - "\\bsnapshot\\.(?:params|paramMap|queryParams|queryParamMap|data)\\b"
sources:
  - https://angular.dev/guide/routing/route-guards
  - https://angular.dev/guide/routing/read-route-state
  - https://github.com/angular/angular/releases/tag/v22.0.0
  - https://github.com/angular/angular/pull/48180
---
- **Guards as security**: `canActivate`/`canMatch` checks without matching server-side authorization → APIs and data remain reachable. Fix: enforce on the server; guards are UX.
- **Stale snapshot**: `route.snapshot.paramMap.get('id')` read once in `ngOnInit` → navigating `/items/1` → `/items/2` reuses the component with old data. Fix: `paramMap` + `switchMap`, or inputs via `withComponentInputBinding()`.
- **v22 params inheritance**: `paramsInheritanceStrategy` now defaults to `'always'` → children inherit all parent params/data; same-named keys (`id`) may resolve differently. Fix: rename, or set `'emptyOnly'` explicitly.
- **First-value guards**: the router takes the first emission — a store selector emitting an initial `false`/`null` before loading → wrong block or redirect. Fix: `filter` until loaded, then `take(1)`.
- **Navigating inside guards**: `router.navigate()` in a guard plus `return false` → competing navigations, lost query params. Fix: return a `UrlTree` or `RedirectCommand`.
- **Lazy chunk still loaded**: `canActivate` on `loadChildren` routes still downloads the chunk (`canLoad` is deprecated and ignores `loadComponent`). Fix: `canMatch` for lazily loaded areas.
- **Blocking resolvers**: slow or failing resolver requests → navigation hangs, or the error cancels it entirely. Fix: handle errors in the resolver (fallback or redirect) or load in the component.
