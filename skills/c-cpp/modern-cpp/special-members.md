---
name: Special members and RAII guards
description: Rule of 0/3/5 defects — shallow copies of owning classes, moves that copy or leave two owners, non-noexcept moves, self-assignment, and RAII guards that are destroyed immediately or lock nothing.
priority: 60
tags: [CWE-415, CWE-416, CWE-667]
activation:
  content:
    - '~\w+\s*\(\s*\)'
    - '\boperator\s*=\s*\('
    - '\b(\w+)\s*\(\s*(?:const\s+)?\1\s*&'
    - '\b(?:lock_guard|unique_lock|scoped_lock|shared_lock)\b'
  examples:
    - '~Widget() { delete[] data_; }'
    - 'Widget& operator=(const Widget& other) { data_ = other.data_; return *this; }'
    - 'Widget(const Widget& other) : data_(other.data_) {}'
    - 'std::lock_guard<std::mutex> lock(mutex_);'
sources:
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-five
  - https://en.cppreference.com/w/cpp/language/move_constructor
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-name
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/object-oriented-programming-oop/oop54-cpp/
---
- **Shallow copies**: a class owning a raw pointer, fd or handle with implicit or defaulted copy operations → two objects release one resource. Fix: rule of zero (`unique_ptr`, RAII members), or define/delete all five (C.21).
- **Suppressed moves**: a user-declared destructor (even `= default`) or copy operation suppresses the implicit move constructor/assignment → every "move" copies. Fix: default the moves explicitly.
- **Moved-from still owning**: moves of raw owning pointers that do not null the source → double free when both objects die. Fix: `std::exchange(other.p, nullptr)`.
- **Throwing moves**: move constructors not `noexcept` make `std::vector` reallocation copy instead of move (`move_if_noexcept`) → large slowdowns. Fix: mark non-throwing moves `noexcept` (C.66).
- **Self-assignment**: `delete data; data = new T(*o.data);` breaks on `a = a` (use-after-free) and loses state if `new` throws (OOP54-CPP). Fix: copy-and-swap, or copy before releasing.
- **Guards that guard nothing**: `std::lock_guard<std::mutex>{m};`, `std::scoped_lock{m};` or `ScopeExit{f};` die at the `;`; `std::unique_lock<std::mutex>(m);` and `std::scoped_lock(m);` declare a new, empty lock named `m` (CP.44). Fix: name every guard.
