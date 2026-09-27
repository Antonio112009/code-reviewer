---
name: Node APIs removed or deprecated in 22-26
description: APIs that throw or warn on current Node release lines - crypto.createCipher, util.is*, fs.rmdir recursive, fs.F_OK, dirent.path, SlowBuffer, _stream_* internals, writeHeader, url.parse, module.register, import assertions and bundled Corepack.
priority: 60
activation:
  content:
    - '\bcreate(?:Cipher|Decipher)\s*\(|\bnew\s+(?:Hash|Hmac)\s*\('
    - '\butil\.(?:is[A-Z]\w*|log|_extend)\b'
    - '\bfs\.[FRWX]_OK\b|\brmdir(?:Sync)?\s*\([^)\n]{0,120}\brecursive\b|\bfs\.truncate\s*\(|\bwithFileTypes\b'
    - '\bSlowBuffer\b|[''"](?:node:)?_(?:stream|tls|http)_\w+[''"]|\.writeHeader\s*\('
    - '\burl\.parse\s*\(|\bmodule\.register\s*\(|\bpunycode\b'
    - '\bassert\s*\{\s*type\s*:|--experimental-transform-types|\bcorepack\b'
sources:
  - https://nodejs.org/api/deprecations.html
  - https://nodejs.org/en/blog/release/v24.0.0
  - https://nodejs.org/en/blog/release/v25.0.0
  - https://nodejs.org/en/blog/release/v26.0.0
---
- **Crypto**: `crypto.createCipher`/`createDecipher` were removed in Node 22 → `TypeError`; `new Hash()`/`new Hmac()` are runtime-deprecated. Fix: `createCipheriv` with a derived key and random IV; `createHash`.
- **util**: `util.isDate`, `util.isString`, `util.isObject`… and `util.log` are gone since Node 23 → "is not a function"; `util.isArray` and `util._extend` are runtime-deprecated. Fix: `typeof`/`instanceof`, `Array.isArray`, `Object.assign`.
- **fs**: `rmdir(p, { recursive: true })` lost `recursive` in Node 25 (use `fs.rm`); `fs.F_OK`/`R_OK`/`W_OK`/`X_OK` removed in 25 (`fs.constants`); `dirent.path` (→ `parentPath`) and `fs.truncate(fd)` (→ `ftruncate`) removed in 24.
- **Buffer, streams, http**: `SlowBuffer` removed in 25 (`Buffer.allocUnsafeSlow`); `_stream_*` internals and `writeHeader()` removed in 26 (`node:stream`, `writeHead`).
- **URL and modules**: `url.parse()` warns for app code since Node 24, throws on invalid ports since 25 (use `URL`); `module.register()` is runtime-deprecated in 26; `assert { type: 'json' }` fails since 22.
- **Tooling**: Node 25+ no longer ships Corepack → `corepack enable` in Dockerfiles, CI and scripts fails on new images; `--experimental-transform-types` is gone in 26. Fix: install the package manager.
