---
name: Hardening and sanitizer flags
description: Security-relevant build flags for C/C++ — removed or ineffective hardening (FORTIFY, stack protection, RELRO/PIE), missing standard-library assertions, sanitizers in production, zero-init in sanitizer builds and blanket -Werror in shipped builds.
category: security
priority: 65
tags: [CWE-693]
activation:
  content:
    - '_FORTIFY_SOURCE|-fstack-(?:protector|clash-protection)|-fcf-protection|-fhardened|-Wl,-z,|-f(?:PIE|pie)\b|-pie\b'
    - '_GLIBCXX_ASSERTIONS|_LIBCPP_HARDENING_MODE|-fsanitize|-ftrivial-auto-var-init|-Werror\b'
sources:
  - https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html
  - https://gcc.gnu.org/gcc-14/changes.html
  - https://libcxx.llvm.org/Hardening.html
---
- **Removed hardening**: dropping `-D_FORTIFY_SOURCE=3`, `-fstack-protector-strong`, `-fstack-clash-protection`, `-fcf-protection`, `-Wl,-z,relro,-z,now` or PIE from release flags → memory bugs become exploitable. Fix: keep the OpenSSF baseline, or GCC 14 `-fhardened`.
- **Ineffective FORTIFY**: `_FORTIFY_SOURCE` does nothing at `-O0`; level 3 needs GCC ≥ 12 or Clang ≥ 9; redefining it clashes with distribution defaults. Fix: `-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3` in optimized configurations.
- **Unchecked library preconditions**: C++ release builds without `-D_GLIBCXX_ASSERTIONS` (libstdc++) or `_LIBCPP_HARDENING_MODE_FAST` (libc++ ≥ 18) leave `operator[]`, `front()` and similar accesses unchecked. Fix: enable them in production builds.
- **Sanitizers in production**: ASan/TSan in release or SUID binaries expose environment-controlled runtime options (file clobbering, privilege escalation); combined with FORTIFY they misreport. Fix: sanitizers only in test builds without FORTIFY.
- **Zero-init in test builds**: `-ftrivial-auto-var-init=zero` in sanitizer/Valgrind builds hides the uninitialized reads those tools should find. Fix: use it for production builds only.
- **Blanket -Werror when shipping**: `-Werror` in distributed build files breaks on every new compiler's warnings. Fix: blanket `-Werror` in CI only; ship selective `-Werror=…` flags.
