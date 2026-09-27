---
name: Dangling views and temporaries
description: References and non-owning views outliving their data — string_view/span from temporaries, c_str() of temporaries, returned views, non-terminated views in C calls, range-for over temporaries before C++23 and stored lazy range views.
priority: 65
tags: [CWE-416, CWE-825]
activation:
  content:
    - '\b(?:string_view|span|c_str|initializer_list)\b'
    - '\b(?:views|ranges)::'
    - '\bstd::(?:min|max|clamp)\s*\('
    - '\bfor\s*\([^;:\n]{1,80}:\s*[\w:]+\([^()\n]{0,40}\)\s*(?:\.|->)'
sources:
  - https://en.cppreference.com/w/cpp/string/basic_string_view
  - https://en.cppreference.com/w/cpp/language/range-for
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/expressions-exp/exp54-cpp/
  - https://en.cppreference.com/w/cpp/ranges/filter_view
---
- **Views of temporaries**: `std::string_view sv = obj.name();` when `name()` returns `std::string` by value, `sv = a + b`, `std::span<const T> s = make_vector();`, `const char* p = get().c_str();` → the buffer dies at the `;`. Fix: keep an owning variable.
- **Returning views**: functions returning `string_view`, `span` or `const T&` to locals, by-value parameters or members of temporaries → dangling at the caller. Fix: return owning types.
- **Not NUL-terminated**: `string_view::data()` passed to C APIs (`fopen`, `strlen`, `%s`) reads past the view. Fix: build a `std::string` for C calls.
- **Range-for over temporaries**: `for (auto& x : make().items())` dangles before C++23 (P2718, implemented in GCC 15 / Clang 19 in C++23 mode). Fix: `for (auto t = make(); auto& x : t.items())`.
- **Reference-returning helpers**: `const auto& m = std::max(a, b + 1);` or `std::clamp` with temporaries → dangling reference. Fix: take the result by value.
- **Stored lazy views**: `views::filter`/`transform` pipelines kept beyond their source container, or elements changed so they no longer satisfy a `filter_view` predicate after `begin()` was cached → UB. Fix: materialize results or rebuild the view.
