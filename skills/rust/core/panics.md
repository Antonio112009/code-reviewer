---
name: Panics on untrusted input
description: std operations that panic on attacker- or environment-controlled values (indexing, byte offsets, unwrap on parse/clock/UTF-8, division, zero-size arguments, RefCell) and crash the request, task or process.
priority: 60
tags: [CWE-248, CWE-129, CWE-617, CWE-369]
activation:
  languages: [rust]
sources:
  - https://doc.rust-lang.org/std/primitive.str.html#method.is_char_boundary
  - https://doc.rust-lang.org/std/time/struct.SystemTime.html#method.duration_since
  - https://doc.rust-lang.org/reference/expressions/operator-expr.html#overflow
  - https://doc.rust-lang.org/std/cell/struct.RefCell.html#method.borrow_mut
---
- **Indexing with input**: `v[i]`, `&buf[a..b]`, `map[&key]`, `split_at`, `drain(range)`, `copy_from_slice` on unequal lengths → panic on out-of-range values. Fix: `get`, `split_at_checked`, length checks.
- **`str` byte offsets**: `&s[..n]` or `truncate(n)` with `n` from byte limits or char counts → panic inside a multi-byte char. Fix: `is_char_boundary`, `floor_char_boundary` (1.91).
- **`unwrap` on external data**: `parse()`, `from_utf8`, `to_str()`, env vars, `CString::new` (interior NUL), `SystemTime::duration_since` (errs when the clock steps back) → one bad input kills the worker. Fix: `?`.
- **Panics in release too**: division or `%` by zero, `i64::MIN / -1`, `Duration::from_secs_f64` on negative/NaN, `Instant + Duration` overflow. Fix: `checked_*`, `try_from_secs_f64`.
- **Zero or huge sizes**: `chunks(0)`, `step_by(0)`; `Vec::with_capacity(n)` or `repeat(n)` with client-sized `n` → panic or allocation abort. Fix: validate and cap.
- **`RefCell` re-borrow**: `borrow_mut()` while another borrow lives (callbacks, recursion) → panic. Fix: shorter borrows, `try_borrow_mut`.
- **Asserts as validation**: `assert!` or `unreachable!()` reachable by request data → DoS. Fix: return errors.
