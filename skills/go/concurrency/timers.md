---
name: Timers and tickers (Go 1.23 semantics)
description: time.After/Tick leaks before Go 1.23, Stop/Reset/drain idioms under old and new timer channels, len(t.C) polling, AfterFunc concurrency and ticker assumptions.
priority: 58
tags: [CWE-401, CWE-362]
activation:
  content:
    - '\btime\.(?:After|AfterFunc|Tick|NewTimer|NewTicker)\b'
    - '\.(?:Reset|Stop)\(\s*\)'
    - '\.Reset\(\s*[\w.*]{1,40}\)'
    - '<-\s*\w{1,30}\.C\b'
  examples:
    - 'timer := time.NewTimer(5 * time.Second)'
    - 'defer ticker.Stop()'
    - 'timer.Reset(delay)'
    - 'select { case <-ticker.C:'
sources:
  - https://go.dev/doc/go1.23
  - https://pkg.go.dev/time#NewTimer
  - https://go.dev/doc/go1.27
---
- **Leaks before 1.23**: with the main module's `go` line < 1.23 (toolchain < 1.27), `time.After` in loops/`select` keeps each timer until it fires and `time.Tick`/unstopped tickers are never freed → memory growth. Fix: `NewTimer` + `Stop`, `defer ticker.Stop()`.
- **Stop/Reset idioms**: under the old buffered channel, `Reset` without draining delivers a stale tick; the drain `if !t.Stop() { <-t.C }` blocks forever when the value was already received. From 1.23 channels are unbuffered and no drain is needed.
- **len(t.C)**: timer channels report len/cap 0 since 1.23 → `if len(t.C) > 0` polling never fires. Fix: non-blocking `select` receive.
- **AfterFunc runs concurrently**: the callback runs in its own goroutine and races with the caller's state; `Stop()` returning false means it ran or is running, not that it finished. Fix: synchronise inside the callback.
- **Ticker assumptions**: tickers drop ticks for slow receivers → "exactly every N seconds" rate or billing math is wrong; `time.Sleep` loops ignore cancellation. Fix: compute from timestamps; `select` on `ctx.Done()`.
