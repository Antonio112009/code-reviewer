---
name: CMake target configuration
description: CMake configuration defects — directory-wide flags and definitions, PRIVATE requirements that public headers need, overwritten CMAKE_<LANG>_FLAGS, build-type checks, standard decay, GLOB source lists and cache/option semantics.
priority: 55
activation:
  content:
    - '\b(?:add_definitions|add_compile_definitions|add_compile_options|include_directories|link_libraries|target_compile_definitions|target_include_directories|target_link_libraries|target_compile_features)\s*\('
    - '\bCMAKE_(?:C|CXX)_(?:FLAGS\w*|STANDARD\w*|EXTENSIONS)\b|\bCMAKE_BUILD_TYPE\b'
    - '\bfile\s*\(\s*GLOB|\boption\s*\(|\bset\s*\([^)\n]{0,120}\bCACHE\b'
sources:
  - https://cmake.org/cmake/help/latest/manual/cmake-buildsystem.7.html
  - https://cmake.org/cmake/help/latest/variable/CMAKE_BUILD_TYPE.html
  - https://cmake.org/cmake/help/latest/prop_tgt/CXX_STANDARD_REQUIRED.html
  - https://cmake.org/cmake/help/latest/policy/CMP0077.html
---
- **Directory-wide settings**: `add_definitions`, `add_compile_options`, `include_directories` reach every later target, vendored ones included → ABI-affecting macros differ from separately built libraries. Fix: `target_*` commands.
- **Wrong visibility**: definitions, include dirs or dependencies used by public headers declared `PRIVATE` → consumers see different headers (layout/ODR mismatch). Fix: `PUBLIC`/`INTERFACE`.
- **Overwritten flags**: `set(CMAKE_CXX_FLAGS "-O2 …")` discards environment, preset and toolchain flags. Fix: append, or `target_compile_options`.
- **Build-type checks**: `if(CMAKE_BUILD_TYPE STREQUAL "Release")` is ignored by multi-config generators (Visual Studio, Xcode, Ninja Multi-Config); an empty type builds without `-O`/`-DNDEBUG`. Fix: `$<CONFIG:…>`; set a default type.
- **Standard decay**: `CMAKE_CXX_STANDARD` without `CMAKE_CXX_STANDARD_REQUIRED ON` silently falls back to an older standard, and misses targets created before it is set. Fix: `target_compile_features(t PUBLIC cxx_std_20)`.
- **GLOB source lists**: `file(GLOB …)` is not re-run when files are added or removed → new sources or tests silently not built. Fix: list sources explicitly.
- **Cache and options**: `set(… CACHE …)` never overrides an existing entry without `FORCE`; with CMP0077 OLD (minimum < 3.13) a subproject's `option()` discards the parent's `set(OPT ON)`. Fix: set the policy.
