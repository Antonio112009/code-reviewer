---
name: Send/Sync impls and global state
description: Thread-safety holes in unsafe code — unsafe impl Send/Sync without bounds, non-thread-safe C handles marked Sync, static mut (also via &raw), env::set_var with other threads running and clashing exported symbols.
priority: 66
tags: [CWE-362, CWE-366, CWE-820]
activation:
  content:
    - '\bunsafe\s+impl\b[^\n{]{0,120}\b(?:Send|Sync)\b'
    - '\bstatic\s+mut\b|\baddr_of(?:_mut)?!|&raw\s+(?:const|mut)\b'
    - '\benv::(?:set_var|remove_var)\('
    - '\bno_mangle\b|\bexport_name\b'
sources:
  - https://doc.rust-lang.org/nomicon/send-and-sync.html
  - https://doc.rust-lang.org/edition-guide/rust-2024/static-mut-references.html
  - https://doc.rust-lang.org/edition-guide/rust-2024/newly-unsafe-functions.html
  - https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-attributes.html
---
- **Unbounded `unsafe impl Send/Sync`**: `unsafe impl<T> Send for Wrapper<T>` without `T: Send` (or `Sync` without `T: Sync`) lets `Rc`, `RefCell` or raw handles cross threads → data races; a classic RustSec pattern. Fix: add the bounds.
- **Non-thread-safe handles marked `Sync`**: `unsafe impl Sync` for C library handles, raw pointers or `Cell`-based state the library doesn't document as thread-safe → races inside C. Fix: `Send` only, a `Mutex`, or confine to one thread.
- **`static mut`**: any access from several threads is a data race; switching `&STATIC` to `&raw mut`/`addr_of_mut!` to silence `static_mut_refs` keeps the race. Fix: atomics, `Mutex`, `OnceLock`/`LazyLock`, `thread_local!`.
- **`env::set_var`/`remove_var`**: unsound while other threads may read the environment (unsafe since edition 2024) — tokio workers, parallel `cargo test` tests, logger threads → crashes in `getenv`. Fix: set before any thread starts; pass config explicitly.
- **Exported symbol clashes**: `#[no_mangle]`/`#[export_name]` (`#[unsafe(...)]` in 2024) named like libc or another crate's symbol (`malloc`, `open`, `init`) → wrong function called or crash. Fix: unique, prefixed names.
