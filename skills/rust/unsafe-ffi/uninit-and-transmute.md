---
name: Uninitialized memory and transmute
description: set_len before initialization, zeroed/assume_init on types with invalid bit patterns, partially initialized buffers, lifetime- or mutability-changing transmutes, repr(Rust) layout assumptions and packed fields.
priority: 66
tags: [CWE-457, CWE-908, CWE-843]
activation:
  content:
    - '\bMaybeUninit\b|\bmem::(?:zeroed|uninitialized)\b|\bassume_init\b'
    - '\btransmute(?:_copy)?\b'
    - '\.set_len\('
    - '#\[repr\((?:packed|transparent|C)'
  examples:
    - 'let mut buf = MaybeUninit::<[u8; 64]>::uninit();'
    - 'let value: u32 = unsafe { mem::transmute(bytes) };'
    - 'unsafe { v.set_len(n) };'
    - '#[repr(packed)]'
sources:
  - https://doc.rust-lang.org/std/mem/union.MaybeUninit.html
  - https://doc.rust-lang.org/std/mem/fn.transmute.html
  - https://doc.rust-lang.org/std/vec/struct.Vec.html#method.set_len
  - https://doc.rust-lang.org/reference/type-layout.html
---
- **`set_len` before initialization**: `v.reserve(n); unsafe { v.set_len(n) }` then filling or reading into it → uninitialized reads, garbage dropped on panic. Fix: write via `spare_capacity_mut()`, then `set_len`; or `resize`.
- **Invalid zero/garbage values**: `mem::zeroed()`/`assume_init()` for references, `Box`, `NonNull`, fn pointers, enums, `bool`, `char` → immediate UB; generic `zeroed::<T>()` escapes the lint. Fix: `MaybeUninit` per field, or `Default`.
- **Partially initialized memory**: `assume_init` after writing only some fields, or uninitialized memory passed as `&mut [u8]` to `Read::read` → UB. Fix: zero the buffer or use `MaybeUninit` slice APIs.
- **Transmuting lifetimes or validity**: `&'a T` → `&'static T`, `&T` → `&mut T` (always UB), external `u8`/`u32` → `bool`/enum → dangling refs, invalid values. Fix: `TryFrom` for enums, `zerocopy`/`bytemuck` checked casts.
- **Default layout assumptions**: casting between `#[repr(Rust)]` types or relying on their field order/size in files, sockets or shared memory → breaks across compiler versions. Fix: `#[repr(C)]`/`#[repr(u8)]`.
- **Packed fields**: `ptr::read` (not `read_unaligned`) through pointers to `#[repr(packed)]` fields is misaligned UB. Fix: `&raw const` (1.82) plus `read_unaligned`.
