---
name: Behaviour-changing compiler flags
description: Compiler and preprocessor flags that change what programs do — fast-math, -march=native, ABI-changing library and LFS/time64 macros set per target, dropped UB-tolerance flags and unpinned language standards (GCC 15/16 defaults).
priority: 60
activation:
  content:
    - '-f(?:fast-math|finite-math-only|unsafe-math-optimizations|no-strict-aliasing|wrapv|no-strict-overflow|no-delete-null-pointer-checks)'
    - '-Ofast\b|-march=|_GLIBCXX_(?:DEBUG|USE_CXX11_ABI)|_FILE_OFFSET_BITS|_TIME_BITS|-std=(?:c|gnu)'
    - '\bCMAKE_(?:C|CXX)_STANDARD\b|\b(?:c|cpp)_std\s*='
  examples:
    - 'target_compile_options(app PRIVATE -ffast-math)'
    - 'add_compile_options(-march=native -D_FILE_OFFSET_BITS=64)'
    - 'set(CMAKE_CXX_STANDARD 17)'
sources:
  - https://gcc.gnu.org/gcc-13/changes.html
  - https://gcc.gnu.org/onlinedocs/gcc/x86-Options.html
  - https://gcc.gnu.org/onlinedocs/libstdc++/manual/debug_mode_using.html
  - https://gcc.gnu.org/gcc-15/changes.html
---
- **fast-math**: `-ffast-math`, `-Ofast` or `-ffinite-math-only` let GCC fold `isnan`/`isinf` to false → NaN checks vanish; before GCC 13, shared libraries built with them switched the whole process to flush-to-zero. Fix: no fast-math where NaN/Inf matter.
- **-march=native**: compiles for the build machine's CPU → SIGILL on older or different machines. Fix: a portable baseline (`-march=x86-64-v2`) plus runtime dispatch.
- **ABI-changing macros per target**: `_GLIBCXX_DEBUG` (container layouts), `_GLIBCXX_USE_CXX11_ABI` or `_FILE_OFFSET_BITS`/`_TIME_BITS` (32-bit `off_t`/`time_t`) set for only some TUs or libraries → types disagree across interfaces. Fix: set them globally.
- **Dropped UB-tolerance flags**: removing `-fno-strict-aliasing`, `-fwrapv`/`-fno-strict-overflow` or `-fno-delete-null-pointer-checks` from code that relied on them → latent UB is optimized into wrong code. Fix: fix the UB first.
- **Unpinned standard**: GCC 15 compiles C as `gnu23` by default (`bool`/`true` keywords, `f()` means no parameters) and GCC 16 compiles C++ as `gnu++20` → toolchain upgrades change meaning. Fix: pin `-std=` / `CMAKE_<LANG>_STANDARD`.
