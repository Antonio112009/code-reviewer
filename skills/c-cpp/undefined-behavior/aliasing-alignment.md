---
name: Type punning, aliasing and alignment
description: Strict-aliasing and alignment UB in C/C++ — casting byte buffers to wider types or structs, misaligned loads (Cortex-M faults), union punning in C++, object-representation tricks and byte-wise struct comparison.
priority: 60
tags: [CWE-704, CWE-758, CWE-188]
activation:
  content:
    - '\breinterpret_cast\s*<'
    - '\(\s*(?:const\s+)?(?:u?int(?:16|32|64)_t|float|double|(?:unsigned\s+)?(?:int|long|short)|struct\s+\w+)\s*\*\s*\)(?!\s*(?:malloc|calloc|realloc)\b)'
    - '\b(?:bit_cast|start_lifetime_as|launder)\b|\bunion\s+\w*\s*\{'
    - '\bmemcmp\s*\(\s*&'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/expressions-exp/exp39-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/expressions-exp/exp36-c/
  - https://en.cppreference.com/w/cpp/language/union
  - https://www.keil.com/appnotes/files/apnt209.pdf
---
- **Punning through pointer casts**: `*(uint32_t *)(buf + off)`, `(struct hdr *)packet`, `*(float *)&bits` → strict-aliasing UB; optimizers reorder or drop accesses at `-O2`. Fix: `memcpy` into a local, or C++20 `std::bit_cast`.
- **Misaligned access**: byte buffers at arbitrary offsets read as wider types (EXP36-C) → faults on strict-alignment CPUs (Cortex-M0; `LDRD`/`LDM` even on M3/M4/M7) and in vectorized code. Fix: `memcpy` or byte-wise decoding.
- **Union punning in C++**: reading a union member other than the last one written is UB in C++ (C allows it; compilers support it only as an extension). Fix: `std::bit_cast` or `memcpy` in portable C++.
- **Object representation tricks**: `reinterpret_cast`/`memcpy` over objects that are not trivially copyable, or reusing storage and reading through old pointers without `std::launder` → UB. Fix: trivially copyable types; C++23 `std::start_lifetime_as` (GCC 16) for raw buffers.
- **Byte-wise comparison and hashing**: `memcmp`/hashing of whole structs or floats compares padding bytes and treats `-0.0`/NaN bit patterns wrongly. Fix: compare and hash field by field.
