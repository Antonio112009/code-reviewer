---
name: Headers, macros and ODR
description: Header and preprocessor defects — per-translation-unit copies of header statics, layouts that drift with macros or #pragma pack, unsafe function-like macros and #if on undefined names.
priority: 55
tags: [CWE-758]
activation:
  files: ['*.{h,hh,hpp,hxx,ipp,inl,tpp}']
  content: ['^[ \t]*#\s*(?:define\s+\w+\(|if\b|elif\b|pragma\s+pack)']
sources:
  - https://gcc.gnu.org/onlinedocs/cpp/Macro-Pitfalls.html
  - https://gcc.gnu.org/onlinedocs/cpp/If.html
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/declarations-and-initialization-dcl/dcl60-cpp/
  - https://clang.llvm.org/docs/DiagnosticsReference.html#wpragma-pack
---
- **State in headers**: `static` or anonymous-namespace variables (caches, counters) defined in a header → one copy per translation unit; updates are invisible elsewhere. Fix: `extern` + one definition, or C++17 `inline` variables.
- **Macro-dependent layouts**: header classes/structs/inline code that change with project macros (`NDEBUG`-only members, feature flags) set differently per TU or library → silent ODR violation, mismatched layouts. Fix: layout-neutral headers.
- **Leaking `#pragma pack`**: `pack(1)`/`pack(push, n)` without the matching `pop` → structs in later headers get another layout, only in some TUs. Fix: pair push/pop in one header.
- **Macro precedence and double evaluation**: unparenthesised parameters/bodies (`#define SQ(x) x*x`) miscompute `SQ(a+1)`; `MAX(i++, n)` repeats side effects. Fix: parenthesise everything, or `static inline` functions.
- **Multi-statement macros**: bodies without `do { … } while (0)` → an `if` guards only the first statement. Fix: wrap the body.
- **Silent `#if`**: `#if HAVE_X` with a misspelled/undefined name is 0; `#ifdef X` is true even when `X` is 0 → code silently compiled in or out. Fix: one convention plus `-Wundef`.
