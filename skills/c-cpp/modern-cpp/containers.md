---
name: Container access
description: std container misuse — map operator[] inserting on lookup, unchecked access to empty or too-short containers, reserve mistaken for resize, vector<bool> proxies and keys mutated inside associative containers.
priority: 55
tags: [CWE-125, CWE-787, CWE-129]
activation:
  content:
    - '\b(?:std::)?(?:vector|deque|array|map|unordered_map|multimap|set|unordered_set|multiset|priority_queue)\s*<'
    - '\.(?:front|back|pop_back|pop_front|top)\s*\(\s*\)|\.reserve\s*\('
  examples:
    - 'std::vector<int> values;'
    - 'values.reserve(count);'
    - 'auto x = values.front();'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/containers-ctr/ctr50-cpp/
  - https://en.cppreference.com/w/cpp/container/map/operator_at
  - https://en.cppreference.com/w/cpp/container/vector_bool
  - https://en.cppreference.com/w/cpp/container
---
- **Lookup that inserts**: `m[key]` on `std::map`/`unordered_map` in read paths inserts a default value → phantom entries, growth, rehash invalidation and data races under reader locks. Fix: `find`, `contains` (C++20) or `at`.
- **Unchecked access**: `v[i]`, `front()`, `back()`, `pop_back()`, `top()` on empty or too-short containers → UB (C++26 hardened libraries, `_GLIBCXX_ASSERTIONS` or libc++ hardening trap instead). Fix: check `empty()`/size; `at()` for external indexes.
- **reserve is not resize**: `v.reserve(n); v[i] = x;` writes past `size()` → UB, and `size()` stays 0. Fix: `resize(n)` or `push_back`.
- **vector<bool> proxies**: `auto b = flags[i];` is a proxy that writes through and dangles with the vector; there is no real `bool*`; neighbouring elements share words, so concurrent writes race. Fix: `bool b = flags[i]`; `std::vector<char>` or `std::bitset`.
- **Mutated keys**: changing members that affect ordering or hashing of `set`/`map`/`unordered_*` elements (via `const_cast`, `mutable` fields or pointers) → lookups fail and the container corrupts. Fix: erase, modify, reinsert (C++17 `extract`).
