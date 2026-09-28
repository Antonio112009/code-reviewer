---
name: Resource API (resource, rxResource, httpResource)
description: Signal-based async loading defects (v19 experimental, v20 renamed options, v22 stable) — resources used for mutations, value() read in error state, params that should stay idle, ignored abort signals and overwritten local values.
priority: 60
activation:
  content:
    - "(?<![.\\w$])(?:resource|rxResource|httpResource)\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "\\bhttpResource\\.(?:text|blob|arrayBuffer)\\s*\\("
    - "\\.hasValue\\s*\\(\\s*\\)"
  examples:
    - 'readonly user = resource({ params: () => id(), loader: fetchUser });'
    - 'const file = httpResource.blob(() => url());'
    - 'if (this.user.hasValue()) { return this.user.value().name; }'
  versions: { framework.angular: ">=19" }
sources:
  - https://angular.dev/guide/signals/resource
  - https://angular.dev/guide/http/http-resource
  - https://github.com/angular/angular/blob/main/CHANGELOG.md
---
- **Mutations through resources**: `httpResource`/`resource` issuing POST/PUT/DELETE → fires eagerly, re-fires when any signal it reads changes, and is aborted when params change. Fix: `HttpClient` for writes, then `reload()` the resource.
- **value() in error state**: since v20, reading `value()` of a resource in `error` status throws → template or `computed` crashes. Fix: guard with `hasValue()` or check `error()` first.
- **Params that should be idle**: `params: () => ({ id: id() })` while `id()` is still `undefined` → loader requests `/users/undefined`. Fix: return `undefined` until inputs exist (the resource stays `idle`).
- **Ignored abortSignal**: a `loader` that doesn't pass `abortSignal` to `fetch`/SDK calls → superseded requests keep running (load, rate limits, late side effects). Fix: forward `abortSignal`.
- **Local value overwritten**: `set()`/`update()` on a resource (status `local`) is replaced by the next params change or `reload()` → optimistic edits lost. Fix: persist first, then reload.
