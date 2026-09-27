---
name: C++20 coroutines
description: Coroutine lifetime and suspension bugs — reference parameters and lambda captures dangling after co_await, locks held across suspension, state changed while suspended, tasks nobody awaits, swallowed exceptions and thread hops.
priority: 65
tags: [CWE-416, CWE-667]
activation:
  content:
    - '\bco_(?:await|yield|return)\b'
    - '\b(?:coroutine_handle|promise_type|suspend_always|suspend_never)\b'
sources:
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcoro-capture
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcoro-locks
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rcoro-reference-parameters
  - https://en.cppreference.com/w/cpp/language/coroutines
---
- **Reference parameters**: coroutine parameters taken as `const&`, `&&`, `string_view`, `span` or raw pointers and used after the first suspension, when the caller's objects may be gone (CP.53). Fix: take owning parameters by value.
- **Capturing coroutine lambdas**: captures live in the closure, not the coroutine frame → use-after-free once the closure dies, even for `shared_ptr` captures (CP.51). Fix: pass them as by-value parameters.
- **Locks across suspension**: `lock_guard`/`unique_lock` alive at `co_await`/`co_yield` → deadlocks, and unlocking on another thread after resumption is UB (CP.52). Fix: release before suspending; async-aware mutexes.
- **State changes while suspended**: iterators, references or checks (sizes, permissions, `this` validity) taken before `co_await` and trusted after resumption, while other code ran → invalidation and TOCTOU. Fix: re-validate after each suspension point.
- **Tasks nobody awaits**: calling a lazy coroutine (`task<T>`, `asio::awaitable`) without `co_await` never runs it or drops its result; detached tasks outlive what they use. Fix: await, or spawn with owned state.
- **Lost exceptions**: `promise_type::unhandled_exception()` swallowing the exception, or never-awaited tasks holding one → failures vanish. Fix: store and rethrow on resume or `get()`.
- **Thread hops**: after `co_await` execution may resume on another thread → `thread_local` data and thread-affine objects (UI, GL contexts) used from the wrong thread. Fix: resume on the owning executor.
