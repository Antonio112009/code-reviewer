---
name: Data races and thread-unsafe APIs
description: Unsynchronized shared state in C/C++ threads — volatile or plain flags, racy lazy initialization, adjacent bit-fields, mutable caches in const methods, and libc functions with hidden global state (strtok, localtime, setenv, setlocale).
priority: 70
tags: [CWE-362, CWE-366, CWE-567]
activation:
  content:
    - '\b(?:std::(?:thread|jthread|async)|pthread_create|thrd_create|_beginthreadex|CreateThread)\b'
    - '\bstd::(?:atomic|mutex|call_once|once_flag)\b|\bpthread_once\s*\(|\bcall_once\s*\('
    - '\bmutable\s+[\w:<>]+\s+\w+'
    - '\b(?:strtok|localtime|gmtime|ctime|asctime|setenv|putenv|unsetenv|setlocale)\s*\('
    - '\bstatic\s+[\w:<>]+\s*\*\s*\w+\s*=\s*(?:nullptr|NULL|0)\s*;'
sources:
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-volatile2
  - https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rconc-double
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/concurrency-con/con32-c/
  - https://man7.org/linux/man-pages/man3/localtime.3.html
---
- **Flags without atomics**: plain or `volatile` `bool`/`int` stop, ready or "initialized" flags shared by threads → data race UB; loads get hoisted (endless loops), and data written before the flag may be seen stale (CP.200). Fix: `std::atomic` / `_Atomic`.
- **Racy lazy initialization**: `if (!inst) inst = new T;` or hand-rolled double-checked locking on a plain pointer → double construction or half-built objects seen (CP.110). Fix: function-local static (thread-safe since C++11), `std::call_once`, C11 `call_once`.
- **Adjacent bit-fields**: bit-fields in one storage unit share a memory location, so threads updating "different" fields lose writes (CON32-C). Fix: separate plain members, or one lock for the struct.
- **const is not thread-safe for your types**: `mutable` caches or lazily computed members inside `const` methods called from several threads → races. Fix: a lock or atomics in the cached path.
- **libc hidden state**: `strtok` and `localtime`/`gmtime`/`ctime`/`asctime` (static buffers) in threads; `setenv`/`putenv`/`unsetenv` while other threads call `getenv` (MT-unsafe; crashes); `setlocale` changes parsing process-wide. Fix: `_r` variants, `uselocale`, environment set before threads start.
