---
name: Number parsing
description: Converting text to numbers in C/C++ — atoi-family and sscanf UB, incomplete strtol error checks, strtoul accepting a minus sign, std::stoi exceptions, from_chars partial parses and base/locale surprises.
priority: 60
tags: [CWE-190, CWE-20, CWE-754]
activation:
  content:
    - '\b(?:ato(?:i|l|ll|f)|strto(?:l|ll|ul|ull|d|f|ld|imax|umax)|sto(?:i|l|ll|ul|ull|f|d|ld)|from_chars|v?f?scanf|sscanf)\s*\('
  examples:
    - 'long v = strtol(s, &endptr, 10);'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/error-handling-err/err34-c/
  - https://man7.org/linux/man-pages/man3/strtoul.3.html
  - https://en.cppreference.com/w/cpp/utility/from_chars
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/exceptions-and-error-handling-err/err62-cpp/
---
- **No error channel**: `atoi`/`atol`/`atof` and `sscanf("%d")` are UB for out-of-range input and turn garbage into 0; unchecked `sscanf` counts leave outputs unset. Fix: `strtol` with full checks, or `std::from_chars`.
- **Incomplete strtol checks**: `errno` not zeroed before the call, `ERANGE` ignored, `endptr == str` (no digits) or trailing junk unchecked, `long` narrowed to `int` unchecked. Fix: check all four.
- **strtoul takes a minus**: `strtoul("-1", …)` returns `ULONG_MAX` without an error, so negative sizes and ids pass validation. Fix: reject a leading `-`, or parse signed and range-check.
- **std::stoi and friends**: throw `invalid_argument`/`out_of_range` (uncaught → terminate on bad input) and accept trailing junk ("12abc" → 12) unless `pos` is checked. Fix: catch; require `pos == s.size()`.
- **std::from_chars**: ignoring `ec`, or not checking `ptr == last`, accepts partial input; leading spaces and `+` are rejected. Fix: check both result fields.
- **Base and locale**: base 0 reads "010" as octal 8; `strtod`/`atof`/`%f` follow `LC_NUMERIC`, so after `setlocale` "3.5" may stop at the dot. Fix: base 10; `from_chars` or the C locale for data formats.
