---
name: CMake versions and policies
description: CMake version-dependent behaviour — minimum versions CMake 4.x rejects, policies pinned OLD by the declared minimum, removed FindBoost/FindPythonInterp, deprecated commands, renamed result variables and upper-case *_ROOT lookups.
priority: 55
activation:
  content:
    - '\bcmake_(?:minimum_required|policy)\s*\(|\bCMP0\d{3}\b|\bCMAKE_POLICY_VERSION_MINIMUM\b'
    - '\bfind_package\s*\(\s*(?:Boost|PythonInterp|PythonLibs|GTest)\b|\bFetchContent_Populate\s*\(|\bexec_program\s*\('
    - '\b[A-Z][A-Z0-9_]{1,40}_(?:FOUND|ROOT)\b'
  examples:
    - 'cmake_minimum_required(VERSION 3.10...3.28)'
    - 'find_package(Boost 1.70 REQUIRED COMPONENTS system)'
    - 'if(OPENSSL_FOUND)'
sources:
  - https://cmake.org/cmake/help/latest/release/4.0.html
  - https://cmake.org/cmake/help/latest/release/3.31.html
  - https://cmake.org/cmake/help/latest/policy/CMP0167.html
  - https://cmake.org/cmake/help/latest/release/4.2.html
---
- **Too-old minimum**: `cmake_minimum_required(VERSION 3.4)` or older is a hard error in CMake ≥ 4.0; below 3.10 is deprecated since 3.31. Fix: `VERSION 3.10...4.4`; `CMAKE_POLICY_VERSION_MINIMUM` only as a packaging stopgap.
- **Minimum pins old behaviour**: policies newer than the declared minimum run OLD (e.g. CMP0126, CMP0144, CMP0167), so raising it silently changes behaviour. Fix: review the policy list when bumping it.
- **Removed find modules**: FindBoost is gone under CMP0167 (3.30; needs Boost ≥ 1.70 `BoostConfig.cmake`), FindPythonInterp/FindPythonLibs under CMP0148 (3.27) → optional lookups quietly fail. Fix: `Boost::` targets, `FindPython3`.
- **Deprecated commands**: single-argument `FetchContent_Populate` (CMP0169, 3.30); `exec_program` is fatal under CMP0153 (3.28). Fix: `FetchContent_MakeAvailable`, `execute_process`.
- **Result variables**: CMake 4.2 deprecates upper-cased `<PACKAGENAME>_FOUND` variants (`OPENSSL_FOUND` vs `OpenSSL_FOUND`); 4.1 deprecates FindGTest's `GTEST_*` variables. Fix: imported targets, case-exact names.
- **Stray *_ROOT variables**: since CMP0144 (3.27) `find_package(Foo)` also searches an upper-case `FOO_ROOT` variable or environment variable → unrelated values redirect the lookup. Fix: rename them.
