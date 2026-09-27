---
name: Event loop blocking
description: Synchronous fs/crypto/zlib/child_process calls and CPU-heavy work on request paths, libuv threadpool saturation (fs, dns.lookup, pbkdf2/scrypt, zlib) and nextTick or microtask starvation.
priority: 65
tags: [CWE-400, CWE-1050]
activation:
  content:
    - '\b[a-z]\w*Sync\s*\('
    - '\b(?:pbkdf2|scrypt|bcrypt|argon2|zlib|brotli|gzip|deflate)\w*\s*\('
    - '\bprocess\.nextTick\s*\(|\bsetImmediate\s*\('
    - '\bUV_THREADPOOL_SIZE\b|\bdns\.lookup\b'
    - '\bwhile\s*\(\s*(?:true|1)\s*\)'
sources:
  - https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
  - https://nodejs.org/api/cli.html#uv_threadpool_sizesize
  - https://nodejs.org/api/dns.html#implementation-considerations
  - https://nodejs.org/api/process.html#processnexttickcallback-args
---
- **Sync APIs on request paths**: `readFileSync`, `execSync`/`spawnSync`, `zlib.*Sync`, `crypto.pbkdf2Sync`/`scryptSync`/`generateKeyPairSync`, `bcrypt.hashSync` inside handlers, middleware or consumers freeze every other request. Fix: async variants; sync only at startup or in CLIs.
- **CPU-heavy work on the main thread**: parsing/stringifying multi-MB JSON, large sorts, image/PDF/CSV processing or regexes over big inputs → p99 spikes, failed health checks, dropped heartbeats. Fix: size limits, streaming parsers, chunking via `setImmediate`, `worker_threads`.
- **Threadpool saturation**: libuv's pool (4 threads) runs async `fs`, `dns.lookup` (used by `http`/`net`), `crypto.pbkdf2`/`scrypt` and `zlib` → slow disks or hashing bursts stall unrelated outbound calls. Fix: bound concurrency; set `UV_THREADPOOL_SIZE` before start, not via `process.env` in code.
- **Microtask starvation**: recursive `process.nextTick` or endless promise chains never yield → timers and I/O never run. Fix: yield with `setImmediate`; prefer `queueMicrotask` over the legacy `nextTick`.
