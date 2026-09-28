---
name: Blocking the async executor
description: Blocking std/sync-driver calls and CPU work inside async code, nested runtimes, sync bridges that panic, block_in_place limits, long-lived spawn_blocking jobs and blocking sockets handed to tokio.
priority: 62
tags: [CWE-400, CWE-833]
activation:
  content:
    - '\bstd::(?:fs|net)::|\bthread::sleep\(|\bstd::sync::mpsc\b'
    - '\bblock_on\(|\bblock_in_place\(|\bspawn_blocking\('
    - '\bblocking_(?:send|recv|lock|read|write)\('
    - '\breqwest::blocking\b|\bfrom_std\('
    - '\bRuntime::new\(|\bBuilder::new_(?:current_thread|multi_thread)\('
    - '\b(?:bcrypt|argon2)::|\bhash_password\b'
  examples:
    - 'let data = std::fs::read_to_string(path)?;'
    - 'let result = tokio::task::spawn_blocking(move || heavy_compute()).await?;'
    - 'tx.blocking_send(event)?;'
    - 'let client = reqwest::blocking::Client::new();'
    - 'let rt = Runtime::new()?;'
    - 'let hash = bcrypt::hash(password, DEFAULT_COST)?;'
sources:
  - https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html
  - https://docs.rs/tokio/latest/tokio/task/fn.block_in_place.html
  - https://docs.rs/tokio/latest/tokio/runtime/struct.Runtime.html#method.block_on
  - https://github.com/tokio-rs/tokio/blob/master/tokio/CHANGELOG.md#1440-march-7th-2025
---
- **Blocking calls on a worker**: `std::fs`, `std::net`, `thread::sleep`, std `mpsc::recv`, `to_socket_addrs` DNS, synchronous clients or bcrypt/argon2 inside `async fn` → every task on that thread stalls. Fix: tokio equivalents or `spawn_blocking`.
- **CPU work without yielding**: compressing, hashing, parsing huge JSON or tight loops between `.await`s starve other tasks and timers. Fix: `spawn_blocking`, rayon plus a channel.
- **Nested runtimes**: `Runtime::new()?.block_on`, `Handle::block_on` or `futures::executor::block_on` inside async code → panic ("Cannot start a runtime from within a runtime") or deadlock. Fix: `.await` instead.
- **Sync bridges that panic**: `reqwest::blocking`, `blocking_send`/`blocking_recv`/`blocking_lock` called from async context panic. Fix: async variants.
- **`block_in_place`**: panics on `current_thread` runtimes (the `#[tokio::test]` default) and pauses other futures of the same task (`join!`, `select!`). Fix: `spawn_blocking`.
- **Long-lived `spawn_blocking`**: endless loops or consumers occupy the blocking pool (512 threads by default), cannot be aborted and make runtime shutdown wait forever. Fix: a dedicated `std::thread`.
- **Blocking sockets**: `TcpStream::from_std` without `set_nonblocking(true)` hangs the runtime; tokio ≥1.44 panics instead. Fix: set non-blocking first.
