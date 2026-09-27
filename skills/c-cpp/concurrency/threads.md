---
name: Threads and async tasks
description: std::thread / jthread / async / pthread lifetime bugs — joinable threads destroyed, detached threads using dead data, blocking and deferred futures, exceptions escaping thread functions, ignored stop tokens and pthread argument/return mistakes.
priority: 65
tags: [CWE-416, CWE-248, CWE-404]
activation:
  content:
    - '\bstd::(?:thread|jthread|async|packaged_task|promise|future|shared_future|stop_token)\b'
    - '\bpthread_(?:create|join|detach|exit|cancel)\s*\(|\bthrd_(?:create|join|detach)\s*\('
    - '\.(?:detach|join)\s*\(\s*\)'
sources:
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-detached_thread
  - https://en.cppreference.com/w/cpp/thread/async
  - https://en.cppreference.com/w/cpp/thread/thread/~thread
  - https://man7.org/linux/man-pages/man3/pthread_create.3.html
---
- **Joinable at destruction**: a `std::thread` destroyed or reassigned while joinable (exception paths, early returns, `t = std::thread(…)`) → `std::terminate`. Fix: join on every path, or C++20 `std::jthread`.
- **Detached threads with borrowed data**: `detach()` with references or pointers to locals, `this` or `std::ref` arguments → use-after-free once the scope ends (CP.26). Fix: pass owned copies or `shared_ptr`; prefer joining.
- **async futures**: a discarded `std::async` future blocks in its destructor, so "background" work runs synchronously; the default policy may defer the task until waited on, and `wait_for` then reports `deferred` forever. Fix: keep the future; `std::launch::async`.
- **Exceptions in thread functions**: an exception escaping a `std::thread`/`jthread` function calls `std::terminate`. Fix: catch inside; return errors via `std::promise` or `packaged_task`.
- **Ignored stop tokens**: `~jthread` requests stop, then joins; threads that never check their `stop_token`, or block in plain `condition_variable::wait` or I/O, hang the destructor. Fix: poll the token; `condition_variable_any` waits with it.
- **pthread arguments and results**: `&i` of a loop variable or a stack buffer passed to `pthread_create` → threads read changing or dead data; `pthread_*` return error numbers, not -1/errno; unjoined, undetached threads leak. Fix: per-thread storage; check codes.
