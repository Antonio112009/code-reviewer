---
name: Raw pointers and slices
description: Undefined behaviour from raw pointer use — from_raw_parts preconditions, allocator/ownership mismatches, aliasing &mut, misaligned reads, double drops via ptr::read and out-of-bounds pointer arithmetic.
priority: 66
tags: [CWE-119, CWE-416, CWE-415, CWE-825]
activation:
  content:
    - '\bfrom_raw_parts(?:_mut)?\b|\bfrom_raw\('
    - '\.(?:add|sub|offset|byte_add)\(|\bget_unchecked(?:_mut)?\('
    - '\bptr::(?:read|write|copy|copy_nonoverlapping|swap)\b|\.read_unaligned\('
    - '\bas\s+\*(?:const|mut)\b|&mut\s+\*\w'
sources:
  - https://doc.rust-lang.org/std/slice/fn.from_raw_parts.html
  - https://doc.rust-lang.org/std/vec/struct.Vec.html#method.from_raw_parts
  - https://doc.rust-lang.org/std/ptr/index.html#safety
  - https://github.com/rust-lang/miri
---
- **Slices from raw parts**: `slice::from_raw_parts(p, len)` with a null or unaligned `p` (UB even for `len == 0`; use `NonNull::dangling()`), an untrusted `len`, or a lifetime not tied to the owner → UB. Fix: validate, bind the lifetime.
- **Allocator mismatch**: `Box::from_raw`, `Vec::from_raw_parts` or `CString::from_raw` on memory not from the matching `into_raw` (e.g. C `malloc`), or with a different capacity → heap corruption. Fix: free with the allocating side.
- **Aliasing `&mut`**: two live `&mut` to the same data via raw pointers (`&mut *p` twice, overlapping `get_unchecked_mut`, writing through a `&T` cast to `*mut T`) → UB even single-threaded. Fix: `split_at_mut`, `get_disjoint_mut` (1.86), `UnsafeCell`.
- **Misaligned reads**: casting `*const u8` to `*const u32` or struct pointers and dereferencing → UB; only debug builds abort, release silently misbehaves. Fix: `read_unaligned`, `from_le_bytes`, `zerocopy`.
- **Double drop**: `ptr::read`/`ptr::copy` of a non-`Copy` value while the original is still dropped → double free. Fix: `mem::take`/`replace`, `ManuallyDrop`.
- **Out-of-bounds arithmetic**: `get_unchecked(i)` or `p.add(i)` past the allocation (even without a dereference) with input-derived `i` → UB. Fix: bounds-check first; test unsafe changes under Miri (`cargo miri test`).
