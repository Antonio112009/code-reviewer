---
name: C/C++ core pitfalls
description: Checks for every C/C++ source change — null checks deleted after a dereference, zero-length calls on NULL, unsequenced side effects, non-void functions falling off the end and logic inside assert().
priority: 60
tags: [CWE-476, CWE-758]
activation:
  files: ['*.{c,h,cc,cpp,cxx,c++,hh,hpp,hxx,ipp,inl,tpp,cppm,ixx,cu,cuh,ino}']
sources:
  - https://en.cppreference.com/w/cpp/language/ub
  - https://developers.redhat.com/articles/2024/12/11/making-memcpynull-null-0-well-defined
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/expressions-exp/exp30-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/miscellaneous-msc/msc37-c/
---
- **Check after use**: pointer dereferenced before its NULL check (`n = p->len; if (!p) …`) → the optimizer deletes the check as dead code. Fix: test before the first use.
- **Zero-length calls on NULL**: `memcpy(d, NULL, 0)` or `memset(NULL, 0, 0)` are UB before C2y (N3322); compilers then assume non-null and drop later checks. Fix: guard with `n > 0`.
- **Unsequenced side effects**: `a[i] = i++`, `i = i++ + 1`, `f(x++, x)` → UB in C and before C++17; C++17 orders `=`/`<<`/`[]` operands, but argument order stays unspecified. Fix: one side effect per statement.
- **Falling off a non-void function**: a path without `return` (switch without `default`, error branch) → UB in C++ (in C once the value is used); optimizers run into unrelated code. Fix: return on every path.
- **Logic inside assert**: side effects (`assert(fd = open(…))`) or the only input validation inside `assert` → removed when `NDEBUG` is set, as in release builds. Fix: do the work outside; validate with real errors.
