---
name: Data races
description: Unsynchronised map, slice, flag and interface access between goroutines — fatal concurrent map writes, memory corruption from multiword races, mixed atomic/plain access and racy lazy initialisation.
priority: 66
tags: [CWE-362, CWE-366]
activation:
  content:
    - '\bgo\s+(?:func\b|[A-Za-z_][\w.]{0,60}\()'
    - '\batomic\.'
    - '\.Go\(\s*func\b'
    - '\bsync\.Map\b'
sources:
  - https://go.dev/ref/mem
  - https://go.dev/doc/articles/race_detector
  - https://pkg.go.dev/sync/atomic
---
- **Concurrent map access**: a map written by one goroutine while another reads or writes it triggers "fatal error: concurrent map writes/read" — `recover` cannot catch it, the whole process dies. Fix: mutex, `sync.Map` or ownership by one goroutine.
- **Shared slices and results**: `results = append(results, r)` or struct fields/captured variables assigned from several goroutines → lost elements, torn values. Fix: preallocate and write `results[i]`, or guard with a mutex.
- **Multiword races corrupt memory**: racing on interface, string or slice values can pair a pointer with the wrong length/type → crashes or arbitrary memory reads, not just stale data. Fix: synchronise; run tests with `-race`.
- **Plain flags**: `done`, `stopped`, config pointers or counters written in one goroutine and polled in another without synchronisation may never be observed or be seen half-initialised. Fix: `atomic.Bool`/`atomic.Pointer[T]`, channels.
- **Mixed atomic access**: a field updated via `atomic.AddInt64` but read or reset plainly elsewhere; 64-bit atomic functions on struct fields are misaligned on 32-bit platforms; `atomic.Value.Store` with a different concrete type panics. Fix: typed atomics (`atomic.Int64`, Go 1.19+).
- **Racy lazy init**: `if cache == nil { cache = load() }` in shared code → double work and races. Fix: `sync.OnceValue` (Go 1.21+).
