---
name: Error wrapping and matching
description: Comparing wrapped errors with == or type assertions, %v breaking the chain, fresh errors.New values that never match, string matching on messages and timeout detection.
priority: 60
tags: [CWE-703]
activation:
  content:
    - '\berrors\.(?:Is|As|AsType|Join|New|Unwrap)\b'
    - '\bfmt\.Errorf\('
    - '\berr\s*[!=]=\s*[A-Za-z_][\w.]{0,40}'
    - '\.Error\(\)'
    - '\berr\.\(\s*\*?[A-Za-z_]'
  examples:
    - 'if errors.Is(err, sql.ErrNoRows) {'
    - 'return fmt.Errorf("query users: %w", err)'
    - 'if err == sql.ErrNoRows {'
    - 'log.Printf("failed: %s", err.Error())'
    - 'if e, ok := err.(*MyError); ok {'
sources:
  - https://go.dev/blog/go1.13-errors
  - https://pkg.go.dev/errors
  - https://go.dev/doc/go1.26
---
- **== on wrapped errors**: `err == sql.ErrNoRows`, `err == io.ErrUnexpectedEOF` or `err.(*MyErr)` fail once any layer wraps (drivers, ORMs, `%w`) → not-found becomes 500, retry logic is skipped. Fix: `errors.Is`, `errors.As` (`errors.AsType[T]` in Go 1.26+).
- **%v drops the cause**: `fmt.Errorf("load: %v", err)` or `errors.New(err.Error())` loses the chain → `errors.Is/As` upstream stop matching. Fix: `%w` (several allowed since Go 1.20).
- **Never-equal sentinels**: `err == errors.New("not found")` or sentinels created inside functions (`func ErrX() error { return errors.New(…) }`) are new values each time → comparisons are always false. Fix: package-level `var ErrX = errors.New(…)`.
- **Message matching**: `strings.Contains(err.Error(), "duplicate key")`/`== "EOF"` break when drivers, locales or libraries change text (encoding/json messages changed in Go 1.27). Fix: typed errors or codes (`*pgconn.PgError.Code`, `*mysql.MySQLError.Number`).
- **Timeouts**: `err == context.DeadlineExceeded` misses `*url.Error`/`*net.OpError` wrappers → timeouts handled as generic failures. Fix: `errors.Is(err, context.DeadlineExceeded)` or `errors.As` to `net.Error` and `Timeout()`.
- **Over-wrapping**: `%w` on driver or third-party errors makes them API — callers match internals, and handlers printing `err.Error()` leak SQL or paths to clients. Fix: translate errors at boundaries.
