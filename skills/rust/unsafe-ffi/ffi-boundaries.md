---
name: FFI boundaries
description: C interop bugs — dangling C strings, unchecked CStr input, panics unwinding out of extern "C" callbacks (abort since 1.81), repr/ABI mismatches (c_long, bool, C enums) and cross-allocator ownership of memory and user_data.
priority: 66
tags: [CWE-416, CWE-476, CWE-704, CWE-762]
activation:
  content:
    - '\bextern\s+"C(?:-unwind)?"'
    - '\bC(?:String|Str)\b|\bc_(?:char|int|long|ulong|void)\b'
    - '#\[repr\(C'
    - '\bcatch_unwind\b|\blibc::|\bbindgen\b'
  examples:
    - 'extern "C" fn on_event(ptr: *const c_char) {'
    - 'let s = unsafe { CStr::from_ptr(ptr) };'
    - '#[repr(C)]'
    - 'let result = catch_unwind(|| process(data));'
sources:
  - https://doc.rust-lang.org/nomicon/ffi.html
  - https://doc.rust-lang.org/std/ffi/struct.CString.html#method.as_ptr
  - https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/
  - https://doc.rust-lang.org/std/ffi/struct.CStr.html#method.from_ptr
---
- **Dangling C strings**: returning or storing `s.as_ptr()` of a `CString`/`Vec` that is dropped or moved while C still uses it (registered callbacks, async C APIs) → use-after-free. Fix: keep the owner alive, or hand over ownership via `into_raw`.
- **C strings coming in**: `CStr::from_ptr` on null or non-NUL-terminated pointers, a returned `&CStr` outliving the C buffer, `to_str().unwrap()` on non-UTF-8 data, `CString::new(input)` failing on interior NUL. Fix: null checks, copy into owned strings.
- **Unwinding across FFI**: a panic escaping an `extern "C"` function aborts the process since Rust 1.81 (UB before) → a crash from a recoverable error. Fix: `catch_unwind` in every callback and return an error code, or deliberate `extern "C-unwind"`.
- **Layout and ABI mismatch**: structs/enums passed to C without `#[repr(C)]`; `i64` for C `long` (32-bit on Windows); Rust `bool` or enums receiving arbitrary C integers → UB. Fix: `core::ffi::c_*` types, integers plus `TryFrom`, bindgen.
- **Ownership across the boundary**: C freeing Rust-allocated memory (or the reverse), or callback `user_data` outliving the `Box` it came from → heap corruption, UAF. Fix: export matching `free_*` functions; unregister callbacks before dropping `user_data`.
