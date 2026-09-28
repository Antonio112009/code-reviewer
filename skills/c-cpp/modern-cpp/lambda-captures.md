---
name: Lambda captures
description: Lambda capture lifetimes — reference and this captures in stored callbacks, threads and async work, by-value copies of non-owning handles, loop-variable captures, self-owning callbacks and mutable state updated on copies.
priority: 60
tags: [CWE-416, CWE-825]
activation:
  content:
    - '\[\s*(?:&|=|this|\*this)\s*[\],]'
    - '\[\s*&\s*\w+\s*[\],]'
    - ',\s*&\s*\w+\s*\]\s*(?:\(|\{|mutable\b)'
  examples:
    - 'auto cb = [this] { process(); };'
    - 'auto cb = [&counter] { counter++; };'
    - 'auto cb = [a, &b]() { b++; };'
sources:
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-value-capture
  - https://en.cppreference.com/w/cpp/language/lambda
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/expressions-exp/exp61-cpp/
---
- **Reference captures that escape**: `[&]`/`[&x]` lambdas stored in `std::function` members, queued on executors, passed to `std::thread`/`detach`/async APIs or returned → run after the locals are gone (F.53, EXP61-CPP). Fix: capture by value or move (`[v = std::move(v)]`).
- **Captured `this`**: `[this]`, `[=]` (implicit `this`, deprecated in C++20) or `[&]` in asynchronous callbacks → the object may be destroyed before the callback runs. Fix: `[self = shared_from_this()]`, a `weak_ptr` check, or cancel callbacks in the destructor.
- **Copies of non-owning handles**: capturing raw pointers, `string_view`, `span` or iterators by value still refers to the original storage. Fix: capture owning values (`std::string`, `shared_ptr`).
- **Loop variables**: tasks started in a loop that capture the loop variable or element by reference all see the last or a dead value. Fix: capture the current value by copy.
- **Self-owning callbacks**: an object storing a callback that captures its own `shared_ptr` → reference cycle, never destroyed. Fix: capture a `weak_ptr`.
- **mutable state on copies**: `mutable` lambdas copied into `std::function`, algorithms or threads update the copy, not the original counter. Fix: shared state by reference on purpose, or return the result.
