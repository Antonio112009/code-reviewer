---
name: Goroutine leaks
description: Goroutines blocked forever on abandoned channels, loops without an exit signal, unbounded per-request goroutines and goroutines stuck on I/O without deadlines.
priority: 64
tags: [CWE-401, CWE-400]
activation:
  content:
    - '\bgo\s+(?:func\b|[A-Za-z_][\w.]{0,60}\()'
    - '\bmake\s*\(\s*(?:<-\s*)?chan\b'
    - '<-\s*[A-Za-z_]'
    - '\.Go\(\s*func\b'
sources:
  - https://go.dev/doc/go1.27
  - https://go.dev/blog/pipelines
  - https://pkg.go.dev/runtime/pprof
---
- **Abandoned sender**: a worker sends its result on an unbuffered channel after the receiver gave up (`select` with `ctx.Done()`/`time.After`, first-result-wins, early error return) → blocked forever. Fix: buffer for every sender, or `select` on `ctx.Done()` when sending.
- **Receiver never released**: `for v := range ch` or `<-ch` waiting on a producer that returns early on error without `close(ch)` → consumer and caller hang. Fix: `defer close(ch)` in the single producer.
- **No exit path**: background loops (`for { … }`, `for range ticker.C`, queue consumers) without a `ctx.Done()` case outlive shutdown and tests; every call that starts one adds another. Fix: pass ctx, return on Done, stop tickers.
- **Unbounded fan-out**: a goroutine per request/item/message without a limit or owner → memory growth under load, work lost at shutdown. Fix: worker pool or semaphore, wait on shutdown.
- **Stuck on I/O**: goroutines reading connections, pipes or response bodies without deadlines or a `Close` on cancel stay forever. Fix: `SetDeadline`, close on ctx cancel. Go 1.27's `goroutineleak` pprof profile (1.26 experiment) or `goleak` in tests catch these.
