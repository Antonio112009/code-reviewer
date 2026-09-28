---
name: Buffer
description: Pooled Buffers sharing one ArrayBuffer, slice/subarray views vs Uint8Array copies, uninitialized allocUnsafe memory, byte vs character lengths, lenient base64/hex decoding and reference comparisons.
priority: 55
tags: [CWE-200, CWE-908]
activation:
  content:
    - '\bBuffer\.(?:from|alloc|allocUnsafe|allocUnsafeSlow|concat|byteLength|compare|poolSize)\b'
    - '\.(?:subarray|byteOffset)\b|\.(?:read|write)U?Int\w*\s*\('
    - '\.buffer\b'
    - '\bnew\s+Buffer\s*\('
  examples:
    - 'const buf = Buffer.allocUnsafe(1024);'
    - 'const view = buf.subarray(0, buf.readUInt32BE(0));'
    - 'const shared = new Uint8Array(buf.buffer);'
    - 'const legacy = new Buffer(16);'
sources:
  - https://nodejs.org/api/buffer.html#bufbyteoffset
  - https://nodejs.org/api/buffer.html#static-method-bufferallocunsafesize
  - https://nodejs.org/api/buffer.html#bufsubarraystart-end
  - https://nodejs.org/api/buffer.html#buffers-and-character-encodings
---
- **Pooled memory behind `buf.buffer`**: small `Buffer.from()`/`allocUnsafe()`/`concat()` results are slices of a shared pool (8 KiB; 64 KiB since Node 24.18/26.3) → `new Uint8Array(buf.buffer)`, WebAssembly, `crypto.subtle` or `postMessage(buf.buffer)` see unrelated bytes. Fix: honour `byteOffset`/`byteLength`, or copy.
- **`slice`/`subarray` are views**: `Buffer#slice` (deprecated) and `subarray` share memory, while `Uint8Array#slice` copies → mutating the "copy" corrupts the source; generic `Uint8Array` code behaves differently for Buffers. Fix: `Buffer.from(buf.subarray(a, b))`.
- **Uninitialized memory**: `Buffer.allocUnsafe(n)` holds old heap data (tokens, other requests' payloads); sending it after a partial fill or short `read` leaks it. Fix: `Buffer.alloc`, or send only `buf.subarray(0, bytesRead)`.
- **Bytes vs characters**: `buf.length` counts bytes, `str.length` UTF-16 units → wrong `Content-Length`, limits and offsets for non-ASCII text. Fix: `Buffer.byteLength(str)`.
- **Lenient decoding**: `Buffer.from(s, 'base64')` skips invalid characters and `'hex'` stops at the first bad pair → malformed tokens or signatures still decode. Fix: validate format and length first.
- **Comparing buffers**: `a == b`/`a === b` compare references - always false for equal content. Fix: `a.equals(b)`, `crypto.timingSafeEqual` for secrets.
