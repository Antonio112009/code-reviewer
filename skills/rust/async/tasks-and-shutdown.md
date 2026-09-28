---
name: Tasks and graceful shutdown
description: tokio task lifecycle bugs — detached tasks losing errors and panics, JoinSet/abort semantics, unbounded spawning, work lost at runtime shutdown, SIGTERM vs ctrl_c, tracing spans in spawned tasks and current-thread test runtimes.
priority: 60
tags: [CWE-400, CWE-404, CWE-755]
activation:
  content:
    - '\bspawn(?:_local)?\(\s*(?:async\b|\w+\()|\bJoinSet\b|\bJoinHandle\b|\bTaskTracker\b'
    - '\bctrl_c\(\)|\bsignal::unix\b|\bSignalKind::'
    - '\bCancellationToken\b|\bshutdown_(?:timeout|background)\('
    - '#\[tokio::(?:main|test)'
    - '\.instrument\(|\.in_current_span\(\)|\.enter\(\)'
  examples:
    - 'let handle: JoinHandle<()> = tokio::spawn(async move { worker(rx).await });'
    - 'signal::ctrl_c().await?;'
    - 'let token = CancellationToken::new();'
    - '#[tokio::main]'
    - 'let response = fetch().instrument(tracing::info_span!("fetch")).await;'
sources:
  - https://docs.rs/tokio/latest/tokio/task/struct.JoinSet.html
  - https://docs.rs/tokio/latest/tokio/signal/fn.ctrl_c.html
  - https://docs.rs/tokio/latest/tokio/runtime/struct.Runtime.html#shutdown
  - https://docs.rs/tracing/latest/tracing/struct.Span.html#in-asynchronous-code
---
- **Fire-and-forget tasks**: a dropped `JoinHandle` detaches the task; its `Err` results and panics (only printed by the panic hook) are lost. Fix: keep handles or a `JoinSet`, check `JoinError`, log errors inside the task.
- **`JoinSet` drop aborts**: dropping a `JoinSet` aborts all its tasks, so a local set in a function that returns early (`?`, timeout) kills in-flight work. Fix: `join_all()`/drain before returning, or `detach_all()` deliberately.
- **Unbounded spawning**: one task per message, connection or item without a limit → memory and FD exhaustion under load. Fix: `Semaphore` permits or bounded concurrency.
- **Shutdown drops work**: when `main` returns or the `Runtime` drops, tasks are cancelled at their next `.await` → queued writes and acks lost. Fix: `CancellationToken` plus `TaskTracker`/`JoinSet` drained with a deadline.
- **Signals**: `ctrl_c()` handles only SIGINT, while Docker/Kubernetes stop with SIGTERM → no graceful shutdown; once awaited, SIGINT no longer terminates by default, so later Ctrl+C is swallowed. Fix: also `signal(SignalKind::terminate())`.
- [full] **Tracing context**: spawned tasks don't inherit the current span, and `span.enter()` guards held across `.await` attach other tasks' events to it. Fix: `.instrument(span)`, `.in_current_span()`, `#[instrument]`.
- [full] **Test runtime**: `#[tokio::test]` is current-thread — spawned tasks run only while the test awaits and races stay hidden. Fix: `flavor = "multi_thread"` for concurrency tests.
