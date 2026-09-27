---
name: Integer overflow and lossy casts
description: Arithmetic that silently wraps in release builds, unsigned underflow, truncating/saturating `as` casts, shift overflow and MIN edge cases.
priority: 60
tags: [CWE-190, CWE-191, CWE-681, CWE-197]
activation:
  content:
    - '\bas\s+(?:[iu](?:8|16|32|64|128|size)|f32|f64)\b'
    - '\.(?:len|count|capacity)\(\)\s*-'
    - '\w\s*-=?\s*1\b'
    - '[\w)\]]\s*<<=?\s*[\w(]'
    - '\.(?:pow|abs|checked_\w+|wrapping_\w+|saturating_\w+|overflowing_\w+|strict_\w+)\('
    - '\.(?:sum|product)::<'
sources:
  - https://doc.rust-lang.org/reference/expressions/operator-expr.html#overflow
  - https://doc.rust-lang.org/reference/expressions/operator-expr.html#numeric-cast
  - https://doc.rust-lang.org/cargo/reference/profiles.html#overflow-checks
  - https://blog.rust-lang.org/2025/10/30/Rust-1.91.0/
---
- **Wraps in release**: `overflow-checks` is off in release, so `+ - *` on sizes, counters or amounts wrap silently while debug tests panic. Fix: `checked_*`, `strict_*` (1.91), or `overflow-checks = true` for release.
- **Unsigned underflow**: `len() - 1`, `end - start`, `total - used` when the left side can be smaller → `usize::MAX`-sized loops, slices, allocations. Fix: compare first, `checked_sub`.
- **Truncating `as`**: `u64 as u32`, `usize as u32` length prefixes, `i64 as usize` of negatives, `u64 as usize` on 32-bit/wasm32 → silently wrong values. Fix: `u32::try_from(x)?`.
- **Float ↔ int**: `f64 as u64` maps NaN to 0, ∞ to MAX, negatives to 0; `u64 as f64` rounds above 2^53 (IDs, cents). Fix: check `is_finite()` and range first; integer minor units for money.
- **Shift overflow**: `x << n` with `n >= bits` panics in debug but shifts by `n % bits` in release (`1u32 << 33 == 2`). Fix: `checked_shl`, validate `n`.
- **MIN edge cases**: `i32::MIN.abs()` and `-i32::MIN` stay negative in release. Fix: `checked_abs`, `unsigned_abs`.
- **Summing input**: `sum::<u32>()`/`product` over request data overflow. Fix: wider accumulator, `try_fold` + `checked_add`.
