---
name: context propagation and cancellation
description: Dropped or replaced contexts in request paths, work that must outlive the request, colliding WithValue keys, ignored cancellation, deadlines inherited by cleanup and contexts stored in structs.
priority: 62
tags: [CWE-400, CWE-404]
activation:
  content:
    - '\bcontext\.(?:Background|TODO|WithValue|WithTimeout\w{0,5}|WithDeadline\w{0,5}|WithCancel\w{0,5}|WithoutCancel|AfterFunc|Cause)\b'
    - '\bctx\.(?:Done|Err|Value)\('
    - '\.Context\(\)'
    - '\bctx\s+context\.Context\b'
  examples:
    - 'ctx, cancel := context.WithTimeout(parent, 5*time.Second)'
    - 'select { case <-ctx.Done():'
    - 'req = req.WithContext(r.Context())'
    - 'func process(ctx context.Context, id string) error {'
sources:
  - https://pkg.go.dev/context
  - https://go.dev/blog/context
  - https://go.dev/doc/go1.21
---
- **Dropped context**: `context.Background()`/`TODO()` inside request paths, or context-less calls (`db.Query`, `http.NewRequest`, `QueryRow`) where `…Context` variants exist → work continues after client disconnects and timeouts. Fix: thread the caller's `ctx`.
- **Work after the response**: goroutines started from a handler with `r.Context()` are cancelled when the handler returns; switching to `Background()` loses trace/auth values and deadlines. Fix: `context.WithoutCancel(ctx)` (Go 1.21+) plus its own timeout.
- **Colliding keys**: `context.WithValue(ctx, "userID", v)` with string/builtin keys can be read or overwritten by other packages/middleware → wrong identity or tenant. Fix: unexported key type per package.
- **Cancellation ignored**: long loops, batch jobs and retry backoffs (`time.Sleep`) never check `ctx.Done()`/`ctx.Err()` → shutdown hangs, cancelled requests keep consuming DB and CPU. Fix: `select` on `ctx.Done()` with a timer.
- **Inherited deadlines**: cleanup, rollback, audit writes or compensations run with an already-cancelled/expired ctx fail instantly; a child `WithTimeout` cannot extend the parent's deadline. Fix: `WithoutCancel` + a short new timeout for cleanup.
- **Stored contexts**: ctx kept in structs, clients or globals → later calls use a cancelled context or another request's values. Fix: pass ctx per call.
