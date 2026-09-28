---
name: Class hierarchies
description: Polymorphism defects — deleting through a base without a virtual destructor, slicing, virtual calls during construction, statically bound default arguments, silent non-overrides, hidden overloads and unchecked downcasts.
priority: 55
tags: [CWE-1079, CWE-758]
activation:
  content:
    - '\b(?:virtual|override|final)\b'
    - '\b(?:class|struct)\s+\w+\s*(?:final\s*)?:\s*(?:public|protected|private|virtual)\b'
    - '\b(?:dynamic_cast|static_cast)\s*<\s*[\w:]+\s*[*&]\s*>'
  examples:
    - 'virtual ~Base() = default;'
    - 'class Derived final : public Base {'
    - 'auto* d = dynamic_cast<Derived*>(base);'
sources:
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-virtual
  - https://en.cppreference.com/w/cpp/memory/unique_ptr
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/object-oriented-programming-oop/oop50-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/object-oriented-programming-oop/oop51-cpp/
---
- **Non-virtual base destructor**: deleting a derived object through `Base*` or `std::unique_ptr<Base>` when `~Base` is not virtual → UB, derived members leak (a `shared_ptr<Base>` made from `Derived` happens to work). Fix: public virtual or protected non-virtual destructor (C.35).
- **Slicing**: polymorphic objects passed, returned, assigned or stored by value (`std::vector<Base>`, `Base b = d;`) → derived state and overrides are lost (OOP51-CPP). Fix: references, pointers, `unique_ptr<Base>`; delete copying in polymorphic bases.
- **Virtual calls in constructors/destructors**: dispatch stops at the class under construction/destruction → the base version runs; pure virtuals abort (OOP50-CPP). Fix: pass data to the base constructor or use two-phase init.
- **Default arguments on virtuals**: defaults come from the static type → `base->draw()` uses `Base`'s default even if `Derived::draw` declares another. Fix: no defaults on virtual functions.
- **Silent non-overrides**: signature drift (`const`, parameter types, `&`-qualifiers) without `override` → a new function hides the base one and base behaviour runs. Fix: `override` everywhere.
- **Hidden overloads**: declaring `f(double)` in `Derived` hides every `Base::f` → calls convert arguments and pick the wrong function. Fix: `using Base::f;`.
- **Unchecked downcasts**: `dynamic_cast<T*>` results used without a null check; `static_cast` to the wrong derived type → UB. Fix: check, or `dynamic_cast` when unsure.
