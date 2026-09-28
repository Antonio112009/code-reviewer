---
name: Untrusted lengths in parsers
description: Parsing attacker-controlled binary data in C/C++ — trusted length fields, wrapping bounds checks, signed lengths, unbounded allocations, stack exhaustion, zero-length loops and double fetches from shared memory.
priority: 80
tags: [CWE-130, CWE-805, CWE-190, CWE-789, CWE-674, CWE-835]
activation:
  content:
    - '\b(?:ntohs|ntohl|be(?:16|32|64)toh|le(?:16|32|64)toh|__builtin_bswap(?:16|32|64)|bswap_(?:16|32|64))\s*\('
    - '\b(?:recv|recvfrom|recvmsg|fread|read|pread|copy_from_user|get_user)\s*\('
    - '\b(?:alloca|_alloca)\s*\('
    - '->\s*(?:len|length|size|count|offset|off|nbytes)\b(?!\s*\()'
  examples:
    - 'uint16_t port = ntohs(hdr->port);'
    - 'n = recv(fd, buf, sizeof(buf), 0);'
    - 'char *tmp = alloca(len);'
    - 'if (offset + pkt->len > buf_size) return -1;'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/arrays-arr/arr30-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int30-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/arrays-arr/arr32-c/
  - https://www.cve.org/CVERecord?id=CVE-2014-0160
---
- **Trusted length fields**: counts, lengths or offsets read from packets, files or IPC drive `memcpy`, loops or indexing without a check against the bytes actually received → over-read (Heartbleed) or overflow. Fix: validate every field against the remaining buffer.
- **Wrapping checks**: `off + len > size`, `p + len > end`, `hdr + body > max` overflow or wrap (pointer overflow is UB and may be optimized away) → the check passes. Fix: `len > size || off > size - len`.
- **Signed lengths**: an `int len` from input checked with `len < MAX` lets negatives through, which become huge `size_t` values in `memcpy`/`malloc`. Fix: unsigned types; reject negatives first.
- **Unbounded allocation**: element counts from input fed to `malloc`, `reserve` or `resize` without a cap → memory exhaustion. Fix: limits relative to the input size.
- **Stack exhaustion**: `alloca`/VLAs sized by input, or recursion over attacker-controlled nesting (JSON, XML, ASN.1, protobuf) → stack overflow or stack clash (ARR32-C). Fix: capped heap buffers, depth limits, `-fstack-clash-protection`.
- **No progress**: TLV loops where a zero or tiny length does not advance the cursor, or `len - hdr` when `len < hdr` → infinite loops or huge copies. Fix: require `len >= hdr` and forward progress.
- **Double fetch**: lengths re-read from shared memory, mmapped files or user-space pointers after validation → the peer changes them in between. Fix: copy once, validate the copy.
