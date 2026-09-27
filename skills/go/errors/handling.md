---
name: Error propagation
description: Shadowed err variables, results used before the error check (Go 1.25 nil-check fix), return nil, nil, ignored errors from Close/Flush/Encode and checks on the wrong variable.
priority: 60
tags: [CWE-252, CWE-476, CWE-703]
activation:
  content:
    - '\berr\b'
    - '\b_\s*=\s*[A-Za-z_][\w.]{0,60}\('
sources:
  - https://go.dev/doc/go1.25
  - https://go.dev/doc/effective_go#errors
  - https://go.dev/ref/spec#Declarations_and_scope
---
- **Shadowed err**: `x, err := f()` inside `if`/`for`/`switch` blocks or closures declares a new `err`; the outer `err` returned later is still nil → the failure is swallowed. Fix: declare once and assign with `=`.
- **Result used before the check**: `f.Name()`, `resp.StatusCode`, `defer resp.Body.Close()` placed before `if err != nil` → nil dereference. Go 1.21–1.24 compilers could delay the nil check so it "worked"; Go 1.25+ panics. Fix: check `err` first.
- **return nil, nil**: returning nil result and nil error for not-found or failed lookups → callers dereference nil. Fix: sentinel `ErrNotFound` or `(value, ok)`.
- **Dropped errors that lose data**: unchecked `Close()` on writers, `Flush()`, `json.NewEncoder(w).Encode`, `Write` or `_ = f()` → truncated output and failed writes reported as success. Fix: check and propagate them.
- **Wrong variable checked**: `v2, err2 := g()` followed by `if err != nil`, or checking `err` where `rows.Err()`/`resp.StatusCode` carries the failure → errors never seen. Fix: one `err`, checked right after each call.
- **Error vs partial result**: functions returning both data and error (`io.Reader`, batch APIs, `ReadAll` on a cut stream) are consumed as all-or-nothing → partial data dropped or treated as complete. Fix: follow the API's contract.
