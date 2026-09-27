---
name: Exceptions and noexcept
description: C++ exception defects — throwing destructors and noexcept functions, exceptions crossing C callbacks and extern "C" boundaries, catch by value, swallowed catch(...), leaks on throw and half-updated state.
priority: 55
tags: [CWE-248, CWE-401, CWE-755]
activation:
  content:
    - '\b(?:throw|try|catch|noexcept|exception_ptr|rethrow_exception|current_exception)\b'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/declarations-and-initialization-dcl/dcl57-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/exceptions-and-error-handling-err/err59-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/exceptions-and-error-handling-err/err61-cpp/
  - https://gcc.gnu.org/onlinedocs/libstdc++/manual/using_exceptions.html
---
- **Throwing destructors**: destructors are implicitly `noexcept` since C++11; throwing from one (flush, commit, close errors) calls `std::terminate` (DCL57-CPP). Fix: explicit `close()`/`commit()` that reports errors; catch inside destructors.
- **Broken `noexcept`**: `noexcept` functions — moves, swaps, callbacks — calling throwing code (`at()`, allocation, `stoi`) → `std::terminate` instead of an error. Fix: drop `noexcept` or handle inside.
- **Crossing boundaries**: exceptions leaving C callbacks (`qsort`, libcurl or SQLite callbacks), `extern "C"` APIs, plugin interfaces or signal handlers → UB or terminate (ERR59-CPP). Fix: catch at the boundary; carry errors as codes or `std::exception_ptr`.
- **Catch by value / `throw e;`**: `catch (std::exception e)` slices and copies; `throw e;` rethrows a sliced copy (ERR61-CPP). Fix: `catch (const T&)` and `throw;`.
- **Swallowing `catch (...)`**: handlers that neither log nor rethrow hide `bad_alloc` and logic errors; glibc thread cancellation unwinds as `abi::__forced_unwind`, which must be rethrown. Fix: catch specific types; rethrow the rest.
- **Leaks on throw**: raw `new`/`malloc`, locks or handles held across calls that may throw, or constructors acquiring several raw resources (no destructor for a half-built object) → leaks, stuck locks. Fix: RAII members.
- **Half-updated state**: members modified before a step that can throw leave the object inconsistent. Fix: work on copies, commit with non-throwing swaps.
