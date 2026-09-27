---
name: Cancellation safety
description: What breaks when a future is dropped mid-way (select!, timeout, abort, client disconnect) — half-applied side effects, non-cancel-safe I/O, lost channel messages, lost queue positions, skipped async cleanup and work that outlives its timeout.
priority: 62
tags: [CWE-362, CWE-459]
activation:
  content:
    - '\bselect!|\btimeout(?:_at)?\(|\.abort\(\)|\bJoinSet\b|\bAbortHandle\b|\bCancellationToken\b'
    - '\.(?:read_exact|read_to_end|read_to_string|read_line|write_all)\('
    - '\b(?:State|Extension|Json|Form|Path|Query)\((?:mut\s+)?\w+\)\s*:'
    - '\bweb::(?:Data|Json|Path|Query|Form)<'
sources:
  - https://docs.rs/tokio/latest/tokio/macro.select.html#cancellation-safety
  - https://docs.rs/tokio/latest/tokio/sync/mpsc/struct.Sender.html#cancel-safety
  - https://github.com/tokio-rs/axum/discussions/1094
---
- **Where futures are dropped**: losing `select!` branches, `tokio::time::timeout` expiry, `abort()` or a dropped `JoinSet`, and axum/hyper handlers when the client disconnects → execution stops at any `.await`; later steps never run.
- **Multi-step side effects**: sequential awaited writes (debit then credit, DB row then queue publish) without a transaction or outbox → half-applied operations on timeout or disconnect. Fix: one transaction, idempotent steps, or `tokio::spawn` the critical part.
- **Non-cancel-safe I/O**: `read_exact`, `read_to_end`, `read_line` or `write_all` inside `select!`/`timeout` lose already transferred bytes → corrupted framing. Fix: cancel-safe `read`/`read_buf` into a persistent buffer, or `tokio_util::codec::Framed`.
- **Sends in `select!`**: a cancelled `mpsc::Sender::send` drops its message. Fix: `reserve()` first, then `permit.send(msg)`.
- **Lost queue position**: tokio `Mutex::lock`, `RwLock::read`/`write`, `Semaphore::acquire` and `Notify::notified` lose their FIFO place when dropped → starvation in retry loops.
- **Async cleanup skipped**: releasing a distributed lock or a remote rollback after an `.await` never happens on cancellation; `Drop` cannot await. Fix: spawn cleanup from `Drop`, or shut down via `CancellationToken`.
- **Timeout is not stop**: a `timeout` around a `JoinHandle` (spawned or `spawn_blocking` work) only stops waiting; the work continues and may finish after a retry. Fix: cooperative cancellation, idempotency keys.
