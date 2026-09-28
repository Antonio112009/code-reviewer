---
name: errgroup and semaphores (golang.org/x/sync)
description: errgroup derived-context lifetime, ignored group context, panics in g.Go, SetLimit deadlocks, only-first-error reporting and semaphore.Weighted misuse.
priority: 62
tags: [CWE-248, CWE-667]
activation:
  content:
    - '\berrgroup\.'
    - '\.(?:Go|TryGo|SetLimit)\('
    - '\bsemaphore\.NewWeighted\b'
    - '\.Acquire\(\s*ctx'
  examples:
    - 'g, ctx := errgroup.WithContext(ctx)'
    - 'g.SetLimit(10)'
    - 'sem := semaphore.NewWeighted(4)'
    - 'if err := sem.Acquire(ctx, 1); err != nil {'
sources:
  - https://pkg.go.dev/golang.org/x/sync/errgroup
  - https://github.com/golang/go/issues/53757
  - https://pkg.go.dev/golang.org/x/sync/semaphore
---
- **Derived context lifetime**: the ctx returned by `errgroup.WithContext` is cancelled on the first error and when `Wait` returns → using it after `Wait` (follow-up queries, returned to callers) fails with `context canceled`. Fix: use the parent ctx after `Wait`.
- **Group context ignored**: goroutines calling with the outer `ctx` instead of the group's → siblings keep running after one fails. Fix: pass `gctx` into every call.
- **Panics crash the process**: a panic inside `g.Go` is neither recovered nor returned by `Wait` (propagation added in x/sync v0.14.0 was reverted). Fix: recover inside the function and return an error.
- **SetLimit deadlocks**: `g.Go` blocks at the limit → calling it from inside a group goroutine, or from a loop that must also drain results, deadlocks; changing the limit while goroutines run panics. Fix: `TryGo`, one spawning loop.
- **Only the first error**: `Wait` returns the first non-nil error; later failures in batch writes are never reported. Fix: collect errors (`errors.Join`) when all matter.
- **Semaphore misuse**: ignoring the error from `sem.Acquire(ctx, n)` proceeds without a permit after cancellation; releasing more than acquired panics. Fix: return on error; pair every Acquire with one Release.
