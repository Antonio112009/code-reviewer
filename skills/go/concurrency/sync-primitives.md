---
name: sync primitives (WaitGroup, Mutex, Once, Pool)
description: WaitGroup.Add placement, unlock paths and non-reentrant mutexes, recursive RWMutex read locks, Once not retrying after failure, sync.Pool reuse hygiene and internal state escaping locks.
priority: 62
tags: [CWE-667, CWE-362, CWE-226]
activation:
  content:
    - '\bsync\.(?:WaitGroup|Mutex|RWMutex|Once\w{0,6}|Pool|Map|Cond)\b'
    - '\.(?:R?Lock|R?Unlock|TryR?Lock)\(\)'
    - '\bwg\.(?:Add|Go|Done|Wait)\('
    - '\.(?:LoadOrStore|LoadAndDelete|CompareAndSwap)\('
sources:
  - https://pkg.go.dev/sync
  - https://go.dev/doc/go1.25
  - https://go.dev/ref/mem
---
- **WaitGroup.Add placement**: `wg.Add(1)` inside the new goroutine, or after `Wait` may have started, lets `Wait` return early → work still running, results missing. Fix: `Add` before `go`, or `wg.Go(f)` (Go 1.25+).
- **Unlock on every path**: `mu.Lock()` without `defer mu.Unlock()` and an early return/panic between → permanent deadlock; `sync.Mutex` is not reentrant, so a locked method calling another locking method self-deadlocks. Fix: defer; unexported unlocked helpers.
- **Recursive RLock**: taking `RLock` twice in one call path deadlocks once a writer queues; `RLock` can't be upgraded to `Lock`. Fix: lock once at the entry point.
- **State escaping the lock**: getters returning the protected map/slice (or a pointer into it) let callers read/write it unlocked → races. Fix: return copies (`maps.Clone`, `slices.Clone`).
- **Once never retries**: if the function passed to `once.Do` fails or panics, later calls skip it and use a nil/partial value forever. Fix: `sync.OnceValues` (Go 1.21, re-panics every call) with error handling, or retryable init.
- **Pool hygiene**: objects from `sync.Pool` must be reset before reuse (previous request's data leaks) and not touched after `Put`; pooling huge buffers pins memory. Fix: `Reset` on get; drop oversized buffers.
- **sync.Map check-then-act**: `Load` then `Store` races between goroutines → duplicates/lost updates. Fix: `LoadOrStore`, `CompareAndSwap`.
