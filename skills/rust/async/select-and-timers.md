---
name: select! loops and timers
description: tokio::select! and timer mechanics — futures rebuilt every loop iteration, random branch order, disabled branches panicking, re-polled completed futures, interval burst defaults and slow branch bodies.
priority: 60
tags: [CWE-835, CWE-400]
activation:
  content:
    - '\bselect!'
    - '\binterval(?:_at)?\(|\bMissedTickBehavior\b'
    - '\bsleep(?:_until)?\('
    - '\bpin!\('
  examples:
    - 'tokio::select! { _ = &mut timeout => break, }'
    - 'let mut ticker = tokio::time::interval(Duration::from_secs(5));'
    - 'tokio::time::sleep(Duration::from_millis(200)).await;'
    - 'tokio::pin!(fut);'
sources:
  - https://docs.rs/tokio/latest/tokio/macro.select.html
  - https://docs.rs/tokio/latest/tokio/time/fn.interval.html
  - https://docs.rs/tokio/latest/tokio/time/enum.MissedTickBehavior.html
---
- **Futures rebuilt per iteration**: `sleep(d)` created inside `loop { select! { .. } }` restarts on every message → timeouts and periodic work never fire under steady traffic. Fix: create it before the loop, `tokio::pin!`, poll `&mut fut`.
- **Random branch order**: `select!` polls branches randomly, so shutdown or priority branches can lose to always-ready work. Fix: `biased;` with shutdown first.
- **All branches disabled**: a pattern that stops matching (`Some(m) = rx.recv()` once the channel closes) disables that branch; with none left and no `else`, `select!` panics. Fix: `else => break`, handle `None`.
- **Re-polling finished futures**: selecting again on a pinned future or `JoinHandle` that already completed panics. Fix: `, if !done` preconditions or `Option` + `fuse()`.
- **`interval` defaults**: the first `tick()` completes immediately and `MissedTickBehavior::Burst` fires all missed ticks after a stall → duplicate runs and bursts against rate-limited APIs; a zero period panics. Fix: `interval_at`, `Delay` or `Skip`.
- [full] **Slow branch bodies**: long `.await`s inside a branch delay the other branches (shutdown, heartbeats) until done. Fix: spawn the work, keep bodies short.
