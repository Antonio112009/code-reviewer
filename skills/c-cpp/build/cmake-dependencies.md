---
name: CMake dependencies
description: Third-party dependency handling in CMake — unpinned FetchContent/ExternalProject sources, downloads without hashes, stale extracted archives, unchecked find_package results, raw library names and two copies of one library in a link.
priority: 55
tags: [CWE-494, CWE-829]
activation:
  content:
    - '\b(?:FetchContent_Declare|FetchContent_MakeAvailable|ExternalProject_Add|CPMAddPackage|find_package|find_library|pkg_check_modules)\s*\('
    - '\b(?:GIT_TAG|GIT_REPOSITORY|URL_HASH|URL_MD5|FIND_PACKAGE_ARGS|DOWNLOAD_EXTRACT_TIMESTAMP)\b'
    - '\btarget_link_libraries\s*\('
  examples:
    - 'FetchContent_Declare(fmt GIT_REPOSITORY https://github.com/fmtlib/fmt.git GIT_TAG e69e5f977d458f2650bb346dadf2ad30c5320281)'
    - 'find_package(OpenSSL 3.0 REQUIRED)'
    - 'target_link_libraries(app PRIVATE OpenSSL::SSL)'
sources:
  - https://cmake.org/cmake/help/latest/module/FetchContent.html
  - https://cmake.org/cmake/help/latest/policy/CMP0135.html
  - https://cmake.org/cmake/help/latest/command/find_package.html
---
- **Unpinned sources**: `GIT_TAG main`, a branch or a movable tag in `FetchContent_Declare`, `ExternalProject_Add` or CPM → builds change without review; supply-chain risk. Fix: full commit hashes, as the FetchContent docs advise.
- **Unverified downloads**: `URL` archives without `URL_HASH SHA256=…`, or `http://` URLs → tampered code compiled in. Fix: HTTPS plus `URL_HASH`.
- **Stale extraction**: with CMP0135 OLD (minimum < 3.24) extracted files keep archive timestamps, so a changed `URL` may not rebuild dependents. Fix: `DOWNLOAD_EXTRACT_TIMESTAMP TRUE` or a newer policy baseline.
- **Unchecked finds**: `find_package(X)` without `REQUIRED` or a minimum version, results never checked → features or security options silently compiled out, or an old system library picked. Fix: `REQUIRED`, versions, explicit fallbacks.
- **Raw library names**: `target_link_libraries(app ssl crypto)` or absolute `.so` paths instead of imported targets (`OpenSSL::SSL`) → missing include dirs and definitions, headers and binaries from different versions. Fix: imported targets.
- **Two copies of one library**: a fetched copy plus a system copy, or two versions pulled by different dependencies, linked into one binary → duplicate symbols or ODR violations with mismatched layouts. Fix: one source (`FIND_PACKAGE_ARGS`, dependency providers).
