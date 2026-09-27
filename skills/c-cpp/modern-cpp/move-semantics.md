---
name: Move semantics
description: std::move / std::forward misuse — using moved-from objects, moves that silently copy, forwarding references moved instead of forwarded, and moves racing with other arguments of the same call.
priority: 60
tags: [CWE-416, CWE-665]
activation:
  content:
    - '\bstd::(?:move|forward|exchange)\s*[(<]'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/expressions-exp/exp63-cpp/
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-move
  - https://en.cppreference.com/w/cpp/language/eval_order
  - https://en.cppreference.com/w/cpp/utility/forward
---
- **Use after move**: a variable read after `std::move(x)` — later in the loop, in retries or logging → standard types are "valid but unspecified" (short strings may still hold text), smart pointers are null (EXP63-CPP). Fix: reassign before reuse.
- **Moves that copy**: `std::move` of a `const` object or `const&` parameter, or of a type without move operations → a silent deep copy. Fix: drop `const` on values meant to be moved from.
- **Forwarding references**: `std::move(arg)` on a `T&&` template parameter moves from callers' lvalues; forwarding one argument into two calls hands the second a moved-from value. Fix: `std::forward<T>(arg)`, exactly once.
- **Move and read in one call**: `f(std::move(p), p->size())`, `m.emplace(std::move(k), k.size())` → parameter initialization order is unspecified, so the other argument may see a moved-from object. Fix: read into a local first.
- **Callee vs arguments before C++17**: `p->run(std::move(p))` is safe only since C++17, where the callee expression is sequenced before the arguments. Fix: avoid the pattern in code built as C++14 or older.
