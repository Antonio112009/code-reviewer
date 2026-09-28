---
name: Format strings
description: printf-family and syslog format string defects in C/C++ — non-literal formats, unannotated varargs wrappers, mismatched conversion specifiers and user-controlled std::format/fmt runtime format strings.
priority: 75
tags: [CWE-134, CWE-686]
activation:
  content:
    - '\b(?:v?(?:f|s|sn|d|as)?printf|v?syslog|errx?|warnx?|verrx?|vwarnx?)\s*\('
    - '\b(?:vformat|runtime_format)\s*\(|\bfmt::runtime\s*\('
    - '__attribute__\s*\(\(\s*(?:__)?format(?:__)?\s*\('
  examples:
    - 'printf(user_supplied_msg);'
    - 'fmt::runtime(user_fmt);'
    - '__attribute__((format(printf, 2, 3)))'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio30-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio47-c/
  - https://gcc.gnu.org/onlinedocs/gcc/Common-Function-Attributes.html
  - https://en.cppreference.com/w/cpp/utility/format/vformat
---
- **Non-literal format**: `printf(msg)`, `fprintf(f, buf)`, `syslog(LOG_ERR, user)`, `snprintf(out, n, input)` with external text → `%x`/`%s` read the stack, `%n` writes memory (FIO30-C). Fix: `printf("%s", msg)`; build with `-Werror=format-security`.
- **Unannotated wrappers**: logging helpers taking `const char *fmt, ...` without `__attribute__((format(printf, i, j)))` → no compile-time checks, and callers pass user strings as the format. Fix: annotate every varargs wrapper.
- **Mismatched specifiers**: `%d` for `size_t`/`long`/`int64_t`, `%lu` for `uint64_t` (32-bit `long` on Windows), `%s` for `std::string`, missing arguments → UB, truncation, crashes (FIO47-C). Fix: `%zu`, `PRId64`, `.c_str()`.
- **Runtime std::format strings**: `std::vformat`/`fmt::runtime` with user-controlled formats throw `std::format_error` (uncaught → terminate) and can reveal other arguments. Fix: constant format strings; pass user text as an argument.
