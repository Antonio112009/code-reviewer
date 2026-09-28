---
name: axum extractors and body limits
description: axum extractor behaviour — Extension/ConnectInfo failing only at runtime, per-request State clones, Option<T> semantics before and after 0.8, which bodies DefaultBodyLimit covers, and repeated query keys.
priority: 63
tags: [CWE-400, CWE-20]
activation:
  content:
    - '\b(?:State|Extension|ConnectInfo|Json|Form|Query|Path|Multipart|Bytes)\s*[<(]'
    - '\bDefaultBodyLimit\b|\bto_bytes\('
    - '\b(?:Optional)?FromRequest(?:Parts)?\b'
  examples:
    - 'async fn handler(State(pool): State<PgPool>, Json(payload): Json<NewUser>) -> impl IntoResponse {'
    - 'let body = to_bytes(req.into_body(), usize::MAX).await?;'
    - 'impl FromRequestParts<AppState> for AuthUser {'
sources:
  - https://docs.rs/axum/latest/axum/struct.Extension.html
  - https://docs.rs/axum/latest/axum/extract/struct.DefaultBodyLimit.html
  - https://docs.rs/axum/latest/axum/extract/struct.Query.html
  - https://github.com/tokio-rs/axum/blob/main/axum/CHANGELOG.md
---
- **Runtime-only extractors**: `Extension<T>` without a matching `.layer(Extension(..))` (or added after the route) returns 500 on every request; `ConnectInfo` fails unless served via `into_make_service_with_connect_info`. Fix: prefer `State` (checked at compile time).
- **Per-request state copies**: `State<AppState>` is cloned for each request, so plain fields (`HashMap`, counters, `Vec`) mutated in a handler change only that copy. Fix: `Arc<Mutex<..>>`, atomics or a database.
- **`Option<T>` semantics**: before 0.8, `Option<T>` turned any rejection (malformed header, invalid JSON) into `None`, e.g. silently anonymous; since 0.8 it requires `OptionalFromRequest(Parts)` and propagates errors. Check intent per version.
- **Body limits**: `DefaultBodyLimit` (2 MB) guards only `Bytes`-based extractors (`Json`, `Form`, `String`, `Bytes`); streaming `Body`/`Request`, `to_bytes(body, usize::MAX)` or `DefaultBodyLimit::disable()` are unbounded. Fix: explicit limits, `RequestBodyLimitLayer`.
- [full] **Repeated query keys**: `Query<T>` cannot deserialize `?id=1&id=2` into a `Vec` (400). Fix: `axum_extra::extract::Query`.
