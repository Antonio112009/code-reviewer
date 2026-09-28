---
name: Atomics and memory ordering
description: std::atomic / C11 _Atomic misuse — relaxed publication, check-then-act on atomics, compare-exchange loop mistakes, uninitialized atomics before C++20, non-lock-free atomics and mixed atomic/plain access.
priority: 65
tags: [CWE-362, CWE-667]
activation:
  content:
    - '\b(?:std::)?atomic(?:_ref|_flag)?\s*<|\batomic_flag\b|\b_Atomic\b'
    - '\bmemory_order(?:_|::)\w+|\.(?:fetch_add|fetch_sub|fetch_or|fetch_and|compare_exchange_(?:weak|strong))\s*\('
    - '\batomic_(?:load|store|exchange|fetch_\w+|compare_exchange_\w+)\s*\(|\b__(?:atomic|sync)_\w+\s*\('
  examples:
    - 'std::atomic<int> counter{0};'
    - 'counter.fetch_add(1, std::memory_order_relaxed);'
    - 'atomic_store(&flag, 1);'
sources:
  - https://en.cppreference.com/w/cpp/atomic/atomic/compare_exchange
  - https://en.cppreference.com/w/cpp/atomic/atomic/atomic
  - https://en.cppreference.com/w/cpp/atomic/atomic_ref
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/concurrency-con/con40-c/
---
- **Relaxed publication**: data written, then a flag or pointer stored with `memory_order_relaxed` (or read relaxed) → readers see the flag but stale data. Fix: `release` store with `acquire` load, or default `seq_cst`.
- **Check-then-act**: `if (n.load() > 0) n--;`, `x = x + 1`, `x.store(x.load() + 1)` → updates lost between the two operations (CON40-C). Fix: `fetch_add`/`fetch_sub` or a compare-exchange loop.
- **Compare-exchange mistakes**: `compare_exchange_weak` outside a loop (fails spuriously); forgetting failure overwrites `expected`; CAS on padded structs or floats compares bytes → never succeeds; lock-free stacks without ABA protection. Fix: loop and re-read.
- **Uninitialized before C++20**: `std::atomic<int> n;` is uninitialized before C++20 (P0883) and a default `std::atomic_flag` is unspecified. Fix: `std::atomic<int> n{0};`, `ATOMIC_FLAG_INIT`.
- **Not lock-free**: `std::atomic<BigStruct>` or unsupported 16-byte types use a hidden lock → unsafe in signal handlers and across processes in shared memory. Fix: check `is_always_lock_free` (C++17).
- **Mixed access**: one object accessed sometimes atomically (`atomic_ref`, `__atomic_*`) and sometimes plainly → data race; while any `std::atomic_ref` exists, all access must use it (C++20). Fix: one discipline per object.
