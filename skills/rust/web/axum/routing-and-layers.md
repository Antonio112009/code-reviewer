---
name: axum routing and layer order
description: axum Router pitfalls — 0.8 path syntax vs older versions, layers wrapping only earlier routes, bottom-to-top layer order, layer vs route_layer for auth, and router construction panics.
priority: 63
tags: [CWE-862, CWE-284]
activation:
  content:
    - '\.(?:route|route_layer|route_service|nest|nest_service|merge|fallback|layer)\('
    - '\bServiceBuilder\b|\bfrom_fn(?:_with_state)?\('
  examples:
    - 'let app = Router::new().route("/users/{id}", get(get_user)).layer(auth_layer);'
    - 'let middleware = ServiceBuilder::new().layer(from_fn(auth));'
sources:
  - https://docs.rs/axum/latest/axum/struct.Router.html
  - https://docs.rs/axum/latest/axum/middleware/index.html#ordering
  - https://tokio.rs/blog/2025-01-01-announcing-axum-0-8-0
---
- **Path syntax by version**: axum ≥0.8 captures with `/{id}` and `/{*rest}`, and the old `/:id`/`/*rest` panics when the router is built; on ≤0.7 `{id}` is a literal segment, so the route silently never matches. Check against the axum version.
- **Layers wrap only earlier routes**: `Router::layer`/`route_layer` apply to routes (and fallback) added before the call; routes added or merged afterwards skip auth, timeouts and CORS. Fix: register all routes, then layers.
- **Execution order**: successive `.layer()` calls run bottom-to-top (last added runs first) while `ServiceBuilder` runs top-to-bottom → auth after rate limiting or logging, CORS preflights rejected by auth. Fix: one `ServiceBuilder` in the intended order.
- [full] **`layer` vs `route_layer`**: auth added with `layer` also runs for unmatched paths (404s become 401s); `route_layer` does not cover the fallback. Choose deliberately.
- **Startup panics**: overlapping routes, `merge` of two routers that both have fallbacks, or empty paths panic at startup; a nested router with its own fallback ignores the outer one. Fix: test router construction.
