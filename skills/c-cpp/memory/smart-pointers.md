---
name: Smart pointer ownership
description: std::unique_ptr / shared_ptr / weak_ptr misuse — second owners from raw pointers, shared_from_this too early, cycles, array deleters, deleters called on null, dangling get() and racy shared_ptr instances.
priority: 65
tags: [CWE-415, CWE-416, CWE-401]
activation:
  content:
    - '\b(?:unique_ptr|shared_ptr|weak_ptr|make_unique|make_shared|enable_shared_from_this|shared_from_this|weak_from_this)\b'
sources:
  - https://en.cppreference.com/w/cpp/memory/shared_ptr
  - https://en.cppreference.com/w/cpp/memory/enable_shared_from_this/shared_from_this
  - https://en.cppreference.com/w/cpp/memory/shared_ptr/~shared_ptr
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/memory-management-mem/mem56-cpp/
---
- **Second owner**: `shared_ptr<T>(raw)`, `unique_ptr<T>(p.get())` or `shared_ptr<T>(this)` for memory another owner manages → double delete (MEM56-CPP). Fix: copy the owner, `shared_from_this()`, `make_shared`.
- **shared_from_this too early**: in a constructor or on an object no `shared_ptr` owns → `std::bad_weak_ptr` (C++17; UB before). Fix: create via `make_shared` first.
- **Ownership cycles**: parent↔child `shared_ptr`s, or callbacks capturing their owner's `shared_ptr` → never freed. Fix: `weak_ptr` back-references.
- **Arrays**: `unique_ptr<T>(new T[n])`, `shared_ptr<T>(new T[n])` → `delete` instead of `delete[]`. Fix: `unique_ptr<T[]>`, `shared_ptr<T[]>` (C++17), `std::vector`.
- **Deleters on null**: unlike `unique_ptr`, `shared_ptr` calls its deleter for null too → `shared_ptr<FILE>(fopen(p, "r"), fclose)` calls `fclose(NULL)` when opening fails. Fix: check before wrapping.
- **Escaping raw pointers**: `release()` results dropped (leak); `get()` pointers kept beyond the owner (dangling); `make_shared` memory held until the last `weak_ptr` dies. Fix: explicit ownership transfer.
- **One instance, many threads**: one `shared_ptr` object read and reassigned concurrently → data race; only the count is atomic. Fix: `std::atomic<std::shared_ptr<T>>` (C++20) or a mutex.
