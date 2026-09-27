---
name: Binary serde formats
description: bincode/postcard/rmp/rkyv pitfalls — serde attributes that corrupt metadata-less formats, positional schema evolution, no default size limits, the bincode 1→2 varint wire change and unchecked zero-copy access.
priority: 56
tags: [CWE-502, CWE-400, CWE-20]
activation:
  content:
    - '\b(?:bincode|postcard|rmp_serde|ciborium|rkyv|bitcode)::'
    - '\bwith_(?:no_)?limit\b|\bconfig::(?:standard|legacy)\(\)'
    - '\b(?:archived_root|access_unchecked|from_bytes_unchecked)\b'
sources:
  - https://docs.rs/bincode/2.0.1/bincode/serde/index.html
  - https://docs.rs/bincode/2.0.1/bincode/config/index.html
  - https://docs.rs/bincode/1.3.3/bincode/config/trait.Options.html
  - https://docs.rs/rkyv/latest/rkyv/fn.access.html
---
- **Attributes that break metadata-less formats**: `skip_serializing_if`, `skip*`, `flatten`, `tag` and `untagged` with bincode (similarly postcard) mis-align fields or fail to decode → lost or garbled data. Fix: plain structs for binary formats.
- **Positional schema evolution**: fields and enum variants are encoded by position/index, so reordering or inserting variants, changing integer widths or adding a field breaks stored data and older peers. Fix: version prefix, append-only variants, explicit migrations.
- **No size limit by default**: bincode 1 (`deserialize`, `DefaultOptions`) and bincode 2 `config::standard()` are unlimited → untrusted length prefixes allocate huge buffers. Fix: `with_limit`, cap the input size.
- **bincode 1 → 2 wire change**: `config::standard()` uses varint integers where 1.x used fixed-size → data written by 1.x doesn't decode unless `config::legacy()`; encode and decode configs must match.
- **Unchecked zero-copy access**: rkyv `access_unchecked`/`archived_root` on bytes from disk or network → UB on malicious input. Fix: validated `rkyv::access` (bytecheck).
