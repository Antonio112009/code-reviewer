---
name: Initialization pitfalls
description: C++ initialization traps — member init order, static initialization order across translation units, brace vs parenthesis constructors, the most vexing parse, indeterminate members and auto with expression templates.
priority: 55
tags: [CWE-665, CWE-457]
activation:
  content:
    - '^[ \t]*[\w:~]+\s*\([^()\n]{0,80}\)\s*:\s*\w+\s*[({]'
    - '\bconstinit\b|^[ \t]*(?:static\s+|inline\s+|extern\s+)?(?:const\s+)?[\w:]+(?:<[^>\n]{0,60}>)?\s+[gs]_\w+\s*[({=]'
    - '\b(?:std::)?(?:vector|basic_string|string)\s*(?:<[^>\n]{0,40}>)?\s*\w+\s*\{\s*\w+\s*,'
    - '\b(?:Eigen|blaze|xt)::'
  examples:
    - 'Widget::Widget(int n) : size_(n), buf_(new int[n]) {}'
    - 'static std::atomic<int> g_counter{0};'
    - 'std::vector<int> v{10, 1};'
    - 'Eigen::MatrixXd c = a * b;'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/object-oriented-programming-oop/oop53-cpp/
  - https://en.cppreference.com/w/cpp/language/siof
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/declarations-and-initialization-dcl/dcl53-cpp/
  - https://eigen.tuxfamily.org/dox/TopicPitfalls.html
---
- **Member init order**: members initialize in declaration order, not mem-initializer order → `A() : size_(n), buf_(new T[size_])` reads garbage when `buf_` is declared first (OOP53-CPP). Fix: don't read other members, or reorder declarations.
- **Static init order across TUs**: namespace-scope objects whose constructors use globals from other files (registries, loggers, config strings) → crashes or empty values depending on link order. Fix: function-local statics, `constexpr`, or C++20 `constinit`.
- **Braces pick initializer_list**: `std::vector<int> v{10, 1}` holds 2 elements, `v(10, 1)` holds 10; `std::string s{65, 'x'}` is "Ax". Fix: parentheses for count/fill constructors.
- **Most vexing parse**: `Widget w();` and `Timer t(Seconds());` declare functions, so no object and no RAII effect exists (DCL53-CPP). Fix: `Widget w;` or `Widget w{}`.
- **Indeterminate members**: members without default initializers (`int count; T* next; bool ready;`) hold garbage in default-constructed objects (`S s;`, `new S`). Fix: default member initializers.
- **auto with expression templates**: `auto c = a * b;` with Eigen/Blaze/xtensor keeps an expression that references its operands (recomputed, or dangling once they die). Fix: spell the result type or call `.eval()`.
