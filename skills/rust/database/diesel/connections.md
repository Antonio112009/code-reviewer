---
name: Diesel connections and transactions
description: Synchronous Diesel calls blocking async executors, pool acquisition waits (r2d2 30 s, deadpool unlimited), queries escaping transaction closures and connections established per request.
priority: 63
tags: [CWE-400, CWE-362]
activation:
  content:
    - '\b(?:Pg|Mysql|Sqlite)Connection\b'
    - '\br2d2::|\bConnectionManager<|\bdeadpool_diesel\b|\bdiesel_async\b|\.interact\('
    - '\.transaction(?:::<[^>\n]{0,60}>)?\(|\.build_transaction\(\)'
sources:
  - https://docs.rs/diesel/latest/diesel/connection/trait.Connection.html#method.transaction
  - https://docs.rs/deadpool/latest/deadpool/managed/struct.Timeouts.html
  - https://docs.rs/r2d2/latest/r2d2/struct.Builder.html
---
- **Sync Diesel on async executors**: `load`, `execute` or `r2d2::Pool::get()` inside `async fn` handlers block the runtime worker (on actix, the whole worker). Fix: `spawn_blocking`/`web::block`, `deadpool_diesel` `.interact(..)`, or `diesel-async`.
- **Pool waits**: r2d2 `get()` blocks up to `connection_timeout` (30 s default) when the pool is drained; deadpool waits without limit unless `Timeouts::wait` is set (timeouts also need a runtime configured). Fix: explicit timeouts and pool sizes.
- **Transaction scope**: inside `conn.transaction(|conn| ..)` every query must use the closure's `conn`; a second pooled connection runs outside the transaction and can deadlock on its locks. Fix: pass the inner connection down.
- **Connection per request**: `PgConnection::establish` in handlers performs a full TCP/TLS/auth handshake per request and can exhaust server connection slots. Fix: a pool created once.
