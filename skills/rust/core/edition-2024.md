---
name: Rust 2024 edition semantics
description: Behaviour changes when a crate moves to edition 2024 (rustc ≥1.85) that compile silently — if-let and tail-expression temporary scopes, cargo-fix rewrites and `safe` items in `unsafe extern` blocks.
priority: 58
tags: [CWE-833, CWE-758]
activation:
  content:
    - '\bedition\s*=\s*"2024"'
    - '\bunsafe\s+extern\b'
    - '#\[unsafe\('
    - '\bsafe\s+(?:fn|static)\b'
  examples:
    - 'edition = "2024"'
    - 'unsafe extern "C" {'
    - '#[unsafe(no_mangle)]'
    - 'safe fn c_add(a: i32, b: i32) -> i32;'
  versions: { lang.rust: '>=1.85' }
sources:
  - https://doc.rust-lang.org/edition-guide/rust-2024/temporary-if-let-scope.html
  - https://doc.rust-lang.org/edition-guide/rust-2024/temporary-tail-expr-scope.html
  - https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html
---
- **`if let` rescoping**: scrutinee temporaries (lock guards, `RefCell` borrows) are now dropped before `else`; code relying on the guard in `else` (check-then-insert under one lock) becomes racy. Fix: take the guard in a `let` first.
- **cargo-fix `match` rewrites**: the `if_let_rescope` migration turns affected `if let` into `match` to keep old drop timing — including old deadlocks (read guard held while `else` takes a write lock). Fix: review each converted block.
- **Tail-expression temporaries**: now dropped before the block's locals; `tail_expr_drop_order` only warns (no auto-fix) → drop order of guards, spans and transaction guards in tail expressions changes silently. Fix: bind temporaries explicitly.
- **`safe` items in `unsafe extern`**: declaring a foreign `safe fn` or `safe static` whose use has pointer, length or threading preconditions lets safe code trigger UB. Fix: mark only precondition-free items `safe`.
