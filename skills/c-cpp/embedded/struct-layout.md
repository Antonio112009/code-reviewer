---
name: Packed structs, bit-fields and byte order
description: Hardware and wire-format layout bugs in embedded C/C++ — pointers to packed members, bit-field register and protocol maps, native byte order on the wire, and size or padding assumptions shared with host tools.
priority: 60
tags: [CWE-188, CWE-198]
activation:
  content:
    - '__attribute__\s*\(\(\s*(?:__)?packed|#\s*pragma\s+pack\b|\b__packed\b'
    - '\b(?:unsigned|signed|int|u?int(?:8|16|32)_t|uint)\s+\w+\s*:\s*\d+\s*;'
    - '\b(?:hton[sl]|ntoh[sl]|__builtin_bswap\d+|__REV\w*)\s*\(|__BYTE_ORDER__'
  examples:
    - 'struct Frame { uint8_t type; uint16_t len; } __attribute__((packed));'
    - 'uint8_t mode : 3;'
    - 'uint16_t be = htons(port);'
sources:
  - https://gcc.gnu.org/gcc-9/changes.html
  - https://en.cppreference.com/w/c/language/bit_field
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/posix-pos/pos39-c/
  - https://docs.arduino.cc/language-reference/en/variables/data-types/int/
---
- **Pointers to packed members**: `&pkt->len` of a `packed` struct passed where an aligned `uint32_t *` is expected → unaligned accesses that fault on Cortex-M0/M0+ and in multi-word instructions (GCC ≥ 9 warns: `-Waddress-of-packed-member`). Fix: copy the member into a local.
- **Bit-fields as layouts**: register maps or protocol headers declared with bit-fields → bit order, straddling and `int` signedness are implementation-defined, and the access width may not match the peripheral. Fix: masks and shifts on fixed-width integers.
- **Byte order**: multi-byte fields of frames, flash images or files used in native order → wrong values between little-endian MCUs and big-endian protocols (POS39-C). Fix: explicit byte assembly or `ntohl`-style conversion at the boundary.
- **Size and padding assumptions**: `sizeof(struct)` used as a wire length, or `int`/`enum`/`bool` sizes assumed equal between MCU and host tools (16-bit `int` on AVR, `-fshort-enums`) → shifted fields. Fix: fixed-width types and `static_assert` on sizes and offsets.
