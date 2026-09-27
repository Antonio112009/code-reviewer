---
name: Uninitialized memory
description: Reads of indeterminate values in C/C++ — locals set on some paths only, malloc/new buffers, outputs of failed calls, padding bytes leaked outward, and why C++26 erroneous behaviour or zero-init flags do not fix them.
priority: 65
tags: [CWE-457, CWE-908, CWE-200]
activation:
  content:
    - '^[ \t]*(?:(?:unsigned|signed|const|static)[ \t]+)?(?:u?int(?:8|16|32|64)_t|size_t|ssize_t|char|int|long|short|float|double|bool|_Bool|struct[ \t]+\w+)[ \t]+\*?\w+(?:\[\w*\])?;'
    - '\b(?:malloc|make_unique_for_overwrite|sscanf|recv|read)\s*\('
    - '\bnew\s+[\w:]+\s*(?:\[[^\]\n]{0,40}\])?\s*;'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/expressions-exp/exp33-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/declarations-and-initialization-dcl/dcl39-c/
  - https://gcc.gnu.org/gcc-16/changes.html
  - https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html
---
- **Some-paths initialization**: locals assigned only in some branches (switch without `default`, error paths, loops that may not run) and read afterwards → UB; optimizers may pick any value. Fix: initialize at declaration.
- **Indeterminate heap memory**: `malloc`, `new T[n]`, `new T` for trivial `T` and C++20 `make_unique_for_overwrite` leave contents indeterminate. Fix: `calloc`, `new T[n]()`, `make_unique<T[]>(n)`, or write before reading.
- **Outputs of failed calls**: `sscanf` fields that did not convert, buffers of failed or short `read`/`recv`, out-parameters of APIs that skip them on error → used anyway. Fix: check return counts and status first.
- **Padding leaks**: structs with padding, unions or partly filled buffers copied to sockets, files, IPC or user space → stack/heap contents disclosed (DCL39-C). Fix: `memset` the whole object before filling it.
- **Mitigations are not fixes**: C++26 turns uninitialized reads into erroneous behaviour (GCC 16) and `-ftrivial-auto-var-init=zero` (GCC ≥ 12, Clang) zero-fills locals — symptoms change, logic stays wrong. Fix: explicit initialization.
