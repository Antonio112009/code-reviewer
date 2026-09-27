---
name: optional, variant and expected
description: Vocabulary-type traps — unchecked access to empty optional/expected, if (opt) on optional<bool>, moved-from optionals still engaged, eager value_or, bad_variant_access, pre-C++20 variant conversions and dropped expected errors.
priority: 55
tags: [CWE-476, CWE-754]
activation:
  content:
    - '\b(?:optional|variant|expected|unexpected|nullopt|get_if|holds_alternative|bad_optional_access|bad_expected_access)\b'
    - '\.(?:value_or|has_value|and_then|or_else|transform_error)\s*\('
sources:
  - https://en.cppreference.com/w/cpp/utility/optional/optional
  - https://en.cppreference.com/w/cpp/utility/expected/operator*
  - https://en.cppreference.com/w/cpp/utility/expected/error
  - https://en.cppreference.com/w/cpp/utility/variant/variant
---
- **Unchecked access**: `*opt`, `opt->`, `*exp` or `exp.error()` without checking `has_value()` → UB (a contract violation only in C++26 hardened libraries); `value()` throws instead. Fix: test first.
- **Truthiness of `optional<bool>`**: `if (flag)` tests presence, not the value → a stored `false` takes the true branch. Fix: `flag.value_or(false)` or `flag == true`.
- **Moved-from optional**: after `auto x = std::move(opt);`, `opt.has_value()` stays true with a moved-from value → an empty string or vector is treated as real data. Fix: `opt.reset()` after moving out.
- **Eager value_or**: `opt.value_or(load_default())` always evaluates its argument → wasted work or side effects. Fix: an `if (!opt)` branch or C++23 `or_else`.
- **variant access**: `std::get<T>(v)` throws `bad_variant_access` for another alternative; a throwing assignment can leave `valueless_by_exception()`, which `visit` rejects. Fix: `get_if`/`visit`; handle the valueless state.
- **Surprising conversions**: before P0608 (C++20; newer libraries back-port it) `std::variant<std::string, bool> v = "text";` stores `true`. Fix: construct the intended alternative explicitly.
- **Dropped errors**: results of functions returning `std::expected` ignored → failures silently lost; the type itself is not `[[nodiscard]]`. Fix: mark such functions `[[nodiscard]]`.
