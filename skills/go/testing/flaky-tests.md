---
name: Flaky and misleading Go tests
description: Sleep-based synchronisation, testing/synctest rules (Go 1.25+), DeepEqual on errors, times and protobufs, benchmarks measuring nothing, and leaked test servers or goroutines.
priority: 48
tags: [CWE-1164]
activation:
  content:
    - '\btime\.Sleep\('
    - '\bsynctest\.'
    - '\breflect\.DeepEqual\(|\bassert\.(?:Equal|EqualValues)\('
    - '\bb\.(?:N|Loop|ResetTimer|StopTimer)\b'
    - '\bhttptest\.New\w{2,15}\('
sources:
  - https://pkg.go.dev/testing/synctest
  - https://go.dev/blog/testing-b-loop
  - https://go.dev/doc/go1.25
---
- **Sleep-based synchronisation**: `time.Sleep` to wait for goroutines, timers or async effects → flaky on loaded CI and slow suites. Fix: channels/WaitGroup, or `testing/synctest` (`synctest.Test`, Go 1.25+; the 1.24 experimental `synctest.Run` is gone since 1.26).
- **synctest rules**: goroutines blocked on mutexes, real network I/O or syscalls are not "durably blocked" → `synctest.Wait` hangs or the test deadlocks; channels/timers created in the bubble panic when used outside it. Fix: `net.Pipe`, `httptest.NewTestServer` (Go 1.27).
- **Deep equality**: `reflect.DeepEqual`/`assert.Equal` on errors, `time.Time` (location/monotonic), protobuf messages or funcs → false failures or false passes. Fix: `errors.Is`, `Time.Equal`, `cmp` with options/`protocmp`.
- **Benchmarks measuring nothing**: `b.N` loops whose result is unused can be optimised away; setup inside the timed region inflates numbers; a benchmark may not mix `b.N` and `b.Loop` loops. Fix: `for b.Loop()` (Go 1.24+) or `b.ResetTimer` plus a sink.
- **Leaks between tests**: `httptest.NewServer` without `Close`, unclosed response bodies and goroutines left running → later tests fail or hang. Fix: `t.Cleanup(srv.Close)`, `goleak`.
