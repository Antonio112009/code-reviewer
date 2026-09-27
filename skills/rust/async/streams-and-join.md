---
name: Streams and concurrent joins
description: futures combinator pitfalls — starving buffered streams, unbounded join_all fan-out, try_join_all cancelling siblings, join! mistaken for parallelism, FuturesUnordered ending when empty and oversized futures.
priority: 58
tags: [CWE-400, CWE-770]
activation:
  content:
    - '\.buffer(?:ed|_unordered)\(|\bFutures(?:Unordered|Ordered)\b'
    - '\b(?:try_)?join_all\(|\b(?:try_)?join!'
    - '\.for_each(?:_concurrent)?\(|\bStreamExt\b'
    - '\bBox::pin\(\s*async\b'
sources:
  - https://rust-lang.github.io/wg-async/vision/submitted_stories/status_quo/barbara_battles_buffered_streams.html
  - https://docs.rs/futures/latest/futures/future/fn.join_all.html
  - https://docs.rs/futures/latest/futures/stream/struct.FuturesUnordered.html
---
- **Buffered stream starvation**: consuming `buffered(n)`/`buffer_unordered(n)` with slow per-item work (`while let Some(x) = s.next().await { slow(x).await }`) stops polling the in-flight futures → their timeouts and keep-alives expire. Fix: do the work inside the buffered futures or spawn it.
- **Unbounded fan-out**: `join_all`/`try_join_all` over request-sized input start everything at once (thousands of calls or connections); `try_join_all` drops the rest mid-flight on the first error → partially applied batch. Fix: `buffer_unordered(n)`, bounded `JoinSet`.
- **`join!` is not parallel**: `join!`, `try_join!` and `FuturesUnordered` run on one task — CPU work doesn't parallelize and one blocking call stalls them all. Fix: `tokio::spawn` for parallelism.
- **Empty `FuturesUnordered` ends loops**: `while let Some(r) = set.next().await` exits as soon as the set is momentarily empty; futures pushed later are never polled. Fix: `select!` over new work and results, or `JoinSet`.
- **Oversized futures**: async fns holding large arrays or buffers across `.await` create huge futures that can overflow the stack when built or spawned (debug builds especially). Fix: `Box::pin` them, heap buffers (`vec![0; N]`).
