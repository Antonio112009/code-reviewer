---
name: Dependency injection scopes
description: Angular DI defects — inject() outside an injection context, root services re-provided per component or lazy route, multi providers overwritten, shared mutable useValue objects and module-level state under SSR.
priority: 60
activation:
  content:
    - "(?<![.\\w$])inject\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "\\bproviders\\s*:\\s*\\["
    - "\\bprovidedIn\\s*:"
    - "\\b(?:InjectionToken|runInInjectionContext|EnvironmentInjector)\\b"
    - "@(?:Injectable|Service)\\s*\\("
    - "\\bmulti\\s*:\\s*true\\b"
sources:
  - https://angular.dev/guide/di/dependency-injection-context
  - https://angular.dev/guide/di/hierarchical-dependency-injection
  - https://angular.dev/guide/di/defining-dependency-providers
  - https://angular.dev/api/router/Route
---
- **inject() outside context**: `inject()` in `ngOnInit`, callbacks, `setTimeout`, after `await` or in helpers called later → NG0203. Fix: constructor/field initializers, or `runInInjectionContext(injector, …)`.
- **Accidental second instance**: a `providedIn: 'root'` service also listed in a component's or lazy route's `providers` → a separate instance; state, caches and tokens diverge. Fix: provide it once.
- **Lazy route injectors**: services provided in lazy `Route.providers` get a child environment injector → one instance per route subtree, not per app. Fix: `providedIn: 'root'` for app-wide state.
- **Missing multi**: providing an extensible token (`HTTP_INTERCEPTORS`, validators, plugin tokens) without `multi: true` → replaces earlier providers or throws. Fix: `multi: true` for every provider of that token.
- **Shared mutable useValue**: `useValue: { … }` objects or arrays mutated at runtime → one object shared by every consumer. Fix: `useFactory` returning a fresh object.
- **Module state under SSR**: caches or current-user data in module-level variables instead of services → shared by all server-rendered requests (each request gets a new app injector, not new modules). Fix: keep request state in DI.
