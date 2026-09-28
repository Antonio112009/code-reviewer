---
name: Parallel tests, subtests and cleanup
description: Parent defers running before parallel subtests, process-wide state in parallel tests, t.Fatal from goroutines, t.Context cancelled before Cleanup, TestMain teardown and helper defers closing resources early.
priority: 50
tags: [CWE-665]
activation:
  content:
    - '\bt\.(?:Parallel|Cleanup|Setenv|Chdir|Context|TempDir)\('
    - '\bgo\s+func\b'
    - '\bfunc\s+TestMain\b'
    - '\bos\.(?:Setenv|Chdir)\('
  examples:
    - 't.Parallel()'
    - 'func TestMain(m *testing.M) {'
    - 'os.Setenv("FOO", "bar")'
    - 'go func() { done <- srv.Serve(ln) }()'
sources:
  - https://pkg.go.dev/testing#T.Parallel
  - https://pkg.go.dev/testing#T.Cleanup
  - https://pkg.go.dev/testing#T.Context
  - https://go.dev/blog/subtests
---
- **defer vs parallel subtests**: subtests calling `t.Parallel()` resume only after the parent function returns, so the parent's `defer teardown()` runs first → subtests hit closed servers/DBs or pass vacuously. Fix: `t.Cleanup(teardown)` or a wrapping `t.Run("group", …)`.
- **Process-wide state**: `t.Setenv`/`t.Chdir` panic in parallel tests; `os.Setenv`, globals, replaced `http.DefaultTransport`, fixed ports or shared DB rows in parallel tests → order-dependent failures. Fix: inject dependencies, per-test resources.
- **Fatal from goroutines**: `t.Fatal`/`FailNow`/`SkipNow` must run on the test goroutine; from a spawned goroutine they don't stop the test, and logging after the test ends panics. Fix: send errors back on a channel.
- **Context lifetime**: `t.Context()` (Go 1.24+) is cancelled before Cleanup functions run → cleanups using it fail silently. Fix: `context.WithoutCancel(t.Context())` or `Background()` in cleanups.
- **Helper defers**: `defer db.Close()` inside a setup helper closes the resource when the helper returns, before the test uses it. Fix: register `t.Cleanup` in the helper.
- **TestMain teardown**: `os.Exit(m.Run())` skips deferred teardown (containers, temp dirs). Fix: tear down before exiting, or just return from `TestMain` (Go 1.15+).
