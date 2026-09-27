---
name: Policies, gates and route authorization
description: Laravel authorization gaps — bound models without a policy check, nested bindings without scopeBindings, Gate::before returning false, permissive FormRequest::authorize, ignored can() results, Sanctum tokenCan and never-expiring tokens, private broadcast channels.
priority: 74
tags: [CWE-639, CWE-862, CWE-863, OWASP-A01]
activation:
  content:
    - '\bRoute::(?:get|post|put|patch|delete|match|any|resource|apiResource)\s*\(|->scopeBindings\s*\('
    - '\bGate::|->authorize\s*\(|->(?:can|cannot|cant)\s*\(|#\[Authorize\b|[''"]can:'
    - '\bfunction\s+(?:authorize|before)\s*\(|\btokenCan\s*\(|\bBroadcast::channel\s*\('
sources:
  - https://laravel.com/docs/13.x/authorization
  - https://laravel.com/docs/13.x/routing#implicit-model-binding-scoping
  - https://laravel.com/docs/13.x/sanctum
  - https://laravel.com/docs/13.x/broadcasting#authorizing-channels
---
- **Bound model, no check**: actions receiving `Post $post` via route model binding without `Gate::authorize()`, `can:` middleware, `#[Authorize]` (13) or a policy call → any id is readable or editable (IDOR).
- **Nested bindings**: `/users/{user}/posts/{post}` does not check that the post belongs to the user unless the route uses `scopeBindings()` or a custom key (`{post:slug}`) → cross-parent access.
- **Gate::before semantics**: any non-null return decides the check → `Gate::before(fn ($u) => $u->isAdmin())` denies every ability to non-admins; return `null` to fall through. A policy `before()` runs only if the policy defines the ability.
- **FormRequest::authorize**: returning `true` (or removing the method) without an ownership check → the request is authorized for everyone.
- **Ignored results**: `Gate::allows()`, `$user->can()` and `Gate::inspect()` only return a value; `@can` in Blade only hides UI → unprotected routes. Fix: `Gate::authorize()`/`abort_unless()`.
- **Sanctum abilities**: `tokenCan()` always returns true for first-party SPA (cookie) requests and tokens never expire unless `expiration` is set → abilities are not user authorization. Fix: policies plus expiring, pruned tokens.
- **Broadcast channels**: `Broadcast::channel('orders.{id}', fn ($user, $id) => true)` or a callback that ignores ownership lets any logged-in user subscribe to other users' private channels. Fix: compare with the authenticated user's ownership.
