---
name: Soundness of safe wrappers
description: Safe APIs around unsafe code that callers can break — safe fns with hidden preconditions, trusting safe traits (size_hint, Ord, Hash), panic safety while invariants are broken, leak-dependent soundness and public fields guarding invariants.
priority: 64
tags: [CWE-758, CWE-787, CWE-415]
activation:
  content:
    - '\bunsafe\s*\{'
    - '\bpub\s+fn\b[^\n{]{0,160}\*(?:const|mut)\s'
    - '\.size_hint\(\)|\bExactSizeIterator\b'
    - '\bManuallyDrop\b|\bmem::forget\b|\bmay_dangle\b'
  examples:
    - 'unsafe { buf.set_len(len) };'
    - 'pub fn as_ptr(&self) -> *const u8 {'
    - 'let (lower, _) = iter.size_hint();'
    - 'let guard = ManuallyDrop::new(value);'
sources:
  - https://doc.rust-lang.org/nomicon/working-with-unsafe.html
  - https://doc.rust-lang.org/nomicon/exception-safety.html
  - https://doc.rust-lang.org/nomicon/leaking.html
  - https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.size_hint
---
- **Safe fns with unsafe preconditions**: a non-`unsafe` `pub fn` that dereferences a raw-pointer argument or trusts a caller index/length inside `unsafe` → safe callers cause UB. Fix: validate, or `unsafe fn` with a `# Safety` section.
- **Trusting safe traits**: unsafe code relying on `size_hint`/`ExactSizeIterator::len`, user `Ord`/`Hash`/`Eq`, `Clone` or `Deref` being correct for memory safety → buggy safe impls cause out-of-bounds writes. Fix: bounds-check; trust only `unsafe trait`s.
- **Panic safety**: calling user code (`clone`, closures, comparisons) while an invariant is broken (length already raised, elements moved out) → double drop or uninitialized reads on panic. Fix: raise lengths after writes; restore state in a guard's `Drop`.
- **Leak-dependent soundness**: guards whose `Drop` must run to keep memory safe (scoped borrows, restoring lengths) break because `mem::forget` and `Rc` cycles are safe. Fix: design so a leaked guard only leaks.
- **Invariants behind public fields**: `pub` fields or safe setters (`len`, `cap`, `ptr`) that unsafe code relies on can be changed from safe code → UB. Fix: private fields, `unsafe` setters.
