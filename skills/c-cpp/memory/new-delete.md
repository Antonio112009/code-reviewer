---
name: new/delete pairing and manual lifetimes
description: C++ allocation/deallocation mismatches — delete vs delete[], free on new, deleting incomplete types, placement new without explicit destruction, checks after plain new and pre-C++17 over-aligned new.
priority: 60
tags: [CWE-762, CWE-763]
activation:
  content:
    - '\bdelete\s*(?:\[\s*\]\s*)?[\w(*]'
    - '\bnew\s*\('
    - '\bnew\s+[\w:<>]+\s*\['
    - '\bstd::destroy_at\b|->\s*~\w+\s*\('
  examples:
    - 'delete[] buffer;'
    - 'void *p = new (buf) Widget();'
    - 'int *arr = new int[10];'
    - 'p->~Widget();'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/memory-management-mem/mem51-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/expressions-exp/exp57-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/memory-management-mem/mem54-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/memory-management-mem/mem57-cpp/
---
- **Array form mismatch**: `delete p` on `new T[n]`, `delete[]` on `new T` → heap corruption or skipped destructors. Fix: containers or `unique_ptr<T[]>`.
- **Mixed families**: `free()` on `new` memory, `delete` on `malloc`/`strdup` results, `realloc` of `new[]` blocks → no destructors, heap corruption (MEM51-CPP). Fix: pair `new`/`delete` and `malloc`/`free`.
- **Incomplete types**: `delete p` where the class is only forward-declared → a non-trivial destructor never runs (EXP57-CPP); pimpl classes with an implicit destructor hit this. Fix: define the destructor where the type is complete.
- **Placement new**: objects built with `new (buf) T` need `p->~T()` or `std::destroy_at`, never `delete`; `buf` must be large and aligned enough (MEM54-CPP). Fix: `alignas(T) std::byte buf[sizeof(T)]`.
- **Null checks after new**: `if (!p)` after plain `new` is dead code (failure throws `std::bad_alloc`), while `new (std::nothrow)` results are used unchecked → null dereference. Fix: match the check to the form.
- **Over-aligned types before C++17**: `new` of `alignas(32/64)` types ignores the extra alignment (MEM57-CPP) → faults in aligned SIMD loads. Fix: C++17 aligned `new` or aligned allocation APIs.
