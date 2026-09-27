---
name: Loop variables before Go 1.22
description: Shared for-loop variables in modules whose go.mod declares go < 1.22 — goroutines, closures, deferred calls, stored pointers and parallel subtests all see the last iteration.
priority: 70
tags: [CWE-362]
activation:
  versions: { lang.go: '<1.22' }
  content:
    - '^[ \t]*for\s[^\n{]{0,160}:='
    - '\bgo\s+func\s*\('
    - '\bt\.Parallel\(\)'
sources:
  - https://go.dev/blog/loopvar-preview
  - https://go.dev/wiki/LoopvarExperiment
  - https://go.dev/doc/go1.22
---
- **Which rule applies**: semantics follow the `go` line of the module's own go.mod (or a file's `//go:build go1.22` line), not the toolchain — a module declaring `go 1.21` keeps shared loop variables even when built with Go 1.27.
- **Goroutines and closures**: `go func(){…v…}()`, `defer func(){…i…}()` or stored callbacks inside the loop capture one shared variable → all see the final or a racing value. Fix: pass it as an argument or `v := v`.
- **Stored addresses**: `append(ptrs, &v)`, `m[k] = &v` or `x.Item = &item` in a range loop → every pointer aliases one variable holding the last element. Fix: `&s[i]` or copy into a new variable.
- **Parallel subtests**: `t.Run(tc.name, func(t *testing.T) { t.Parallel(); … tc … })` → every subtest checks the last case, so other cases pass silently. Fix: `tc := tc` before `t.Run`.
- **Fan-out helpers**: `g.Go(func() error { return fetch(id) })` or `wg.Add(1); go work(&item)` in a loop processes one element many times → wrong results, no error. Fix: per-iteration copy.
