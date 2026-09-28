---
name: defer, panic and recover
description: Panics in goroutines crashing the process, recover rules, defers in loops, early-evaluated defer arguments, named results and os.Exit/log.Fatal skipping defers.
priority: 62
tags: [CWE-248, CWE-404]
activation:
  content:
    - '\bdefer\s+func\b'
    - '^\t{2,}defer\b'
    - '\bdefer\s+[\w.]{1,60}\([^)\n]{1,200}\)'
    - '\b(?:panic|recover)\s*\('
    - '\bos\.Exit\s*\('
    - '\blog\.(?:Fatal|Panic)\w{0,2}\('
    - '\bgo\s+func\b'
  examples:
    - 'defer func() { tx.Rollback() }()'
    - '		defer rows.Close()'
    - 'defer finish(err)'
    - 'if r := recover(); r != nil {'
    - 'os.Exit(1)'
    - 'log.Fatalf("failed: %v", err)'
    - 'go func() { worker(item) }()'
checks:
  - id: defer-in-loop
    language: Go
    message: defer inside a loop runs only when the function returns — files, locks or transactions pile up until then
    severity: major
    confidence: 0.6
    rule:
      kind: defer_statement
      inside:
        kind: for_statement
        stopBy:
          any:
            - kind: func_literal
            - kind: function_declaration
            - kind: method_declaration
    examples:
      - "func f(names []string) {\n\tfor _, n := range names {\n\t\tfile, _ := os.Open(n)\n\t\tdefer file.Close()\n\t}\n}"
sources:
  - https://go.dev/ref/spec#Handling_panics
  - https://go.dev/ref/spec#Defer_statements
  - https://go.dev/blog/defer-panic-and-recover
  - https://pkg.go.dev/os#Exit
---
- **Goroutine panics kill the process**: a panic in any goroutine without its own `recover` ends the program; HTTP/gRPC/framework recovery only covers the handler goroutine. Fix: recover inside background and fire-and-forget goroutines.
- **recover placement**: `recover()` works only when called directly by the deferred function — in a helper it calls, or outside `defer`, it returns nil and the panic continues.
- **Swallowed panic result**: recovering in a function with unnamed results returns zero values — often a nil error → the caller treats a crash as success. Fix: named `err` result set in the deferred recover.
- **defer in loops**: deferred `Close`/`Unlock`/`Rollback` in a loop run only when the function returns → descriptors, connections and locks pile up. Fix: move the body into a function.
- **Arguments evaluated at defer time**: `defer finish(err)` or `defer span.End(status)` captures the current (usually nil) value; `defer f.Close()` then reassigning `f` closes the old file. Fix: `defer func() { finish(err) }()`.
- **os.Exit and log.Fatal**: skip every deferred call (unflushed writers, open transactions, temp files, telemetry); inside libraries or goroutines they also bypass the caller's error handling. Fix: return errors; exit only in `main`.
