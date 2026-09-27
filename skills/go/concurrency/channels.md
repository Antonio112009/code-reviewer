---
name: Channel semantics
description: Close ownership panics, zero values from closed channels, nil channels blocking forever, select randomness and busy loops, and racy len/cap checks.
priority: 60
tags: [CWE-667, CWE-835]
activation:
  content:
    - '\bchan\b'
    - '\bclose\s*\('
    - '\bselect\s*\{'
    - '<-\s*[A-Za-z_]'
sources:
  - https://go.dev/ref/spec#Close
  - https://go.dev/ref/spec#Select_statements
  - https://go.dev/ref/mem
---
- **Close ownership**: closing on the receiver side or from several senders → "send on closed channel"/"close of closed channel" panics crash the process. Fix: one owner closes after all senders finish, or use a done channel.
- **Reads after close**: `v := <-ch` on a closed channel returns the zero value immediately → loops spin at 100% CPU or process zero values as real items. Fix: `v, ok := <-ch` or `for v := range ch`.
- **nil channels**: sending/receiving on a nil channel (unset struct field, `var ch chan T`) blocks forever — in `select` that case is silently disabled → deadlocks or never-firing events. Fix: `make` in the constructor.
- **select is random**: when several cases are ready one is picked at random — work may continue after `ctx.Done()`, and "priority" orderings are not honoured. Fix: check `ctx.Err()` before each unit of work.
- **Busy default**: `for { select { … default: } }` without blocking spins a CPU core. Fix: block on channels or a ticker.
- **len/cap checks**: `if len(ch) < cap(ch) { ch <- v }` or `len(ch) == 0` as an emptiness test race with other goroutines → unexpected blocking or lost messages. Fix: `select` with `default` for non-blocking send/receive.
