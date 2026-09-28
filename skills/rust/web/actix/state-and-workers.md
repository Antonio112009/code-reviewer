---
name: actix-web state and workers
description: actix-web 4 worker model pitfalls — state, pools and session keys built inside the per-worker HttpServer::new closure, web::Data type mismatches that 500 at runtime, and blocking calls stalling a worker.
priority: 63
tags: [CWE-362, CWE-400, CWE-384]
activation:
  content:
    - '\bHttpServer::new\b|\.app_data\(|\bweb::(?:Data|ThinData)\b|\bData::new\('
    - '\bKey::generate\(|\bSessionMiddleware\b'
    - '\bweb::block\(|\.workers\('
  examples:
    - 'HttpServer::new(move || App::new().app_data(web::Data::new(pool.clone())))'
    - 'let session_mw = SessionMiddleware::new(store, Key::generate());'
    - 'HttpServer::new(app).workers(4)'
  versions: { framework.actix: '>=4' }
sources:
  - https://actix.rs/docs/application#shared-mutable-state
  - https://docs.rs/actix-web/latest/actix_web/web/struct.Data.html
  - https://docs.rs/actix-session/latest/actix_session/
  - https://actix.rs/docs/server#multi-threading
---
- **State built inside `HttpServer::new`**: the closure runs once per worker, so `Data::new(Mutex::new(..))`, caches, counters, rate limiters and DB pools created there are per-worker → divergent state, N× connections. Fix: build outside, `move` a clone in.
- **`Data` type mismatch**: registering `Data<Arc<T>>` (or raw `app_data(x)`) but extracting `web::Data<T>` compiles, then every request to that handler returns 500. Fix: register and extract the same type; `Data` is already an `Arc`.
- **Per-worker session keys**: `SessionMiddleware::new(store, Key::generate())` inside the closure gives each worker its own key (sessions randomly rejected) and a new key per restart or replica. Fix: load `Key::from(..)` from configuration, outside the closure.
- **Blocking a worker**: each worker runs a single-threaded runtime; diesel/rusqlite calls, `std::fs`, password hashing or `thread::sleep` in handlers stall every connection on that worker. Fix: `web::block` or async drivers.
