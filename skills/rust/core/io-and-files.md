---
name: I/O and files
description: Errors swallowed when writers are dropped, partial reads/writes, unbounded reads, truncating or racy file creation, non-atomic replacement, predictable temp files and late permission changes.
priority: 58
tags: [CWE-252, CWE-400, CWE-367, CWE-377, CWE-732]
activation:
  content:
    - '\b(?:BufWriter|GzEncoder|ZlibEncoder)\b'
    - '\bFile::(?:create|open|create_new)\b|\bOpenOptions\b'
    - '\bfs::(?:write|read|read_to_string|rename|copy|set_permissions)\b'
    - '\.(?:write|read|read_to_end|read_to_string|flush|sync_all)\(|\.take\(\s*\d'
    - '\btemp_dir\(\)|\btempfile\b'
sources:
  - https://doc.rust-lang.org/std/io/struct.BufWriter.html
  - https://doc.rust-lang.org/std/fs/struct.File.html
  - https://doc.rust-lang.org/std/io/trait.Write.html#tymethod.write
---
- **Relying on `Drop` to finish writes**: `BufWriter`, compression encoders and `File` flush or close on drop but ignore errors (disk full, NFS) → truncated output reported as success. Fix: `flush()?`/`into_inner()?`/`finish()?`, then `sync_all()?` when durability matters.
- **Partial I/O**: ignoring the count returned by `write()`/`read()` (they may move fewer bytes) → truncated frames or files. Fix: `write_all`, `read_exact`.
- **Unbounded reads**: `read_to_end`, `read_to_string` or `fs::read` on sockets, uploads or user-chosen files, or `Vec::with_capacity(len_from_header)` → memory exhaustion. Fix: `.take(limit)`, check `metadata().len()`.
- **Truncating or racy create**: `File::create`/`fs::write` truncate existing files; `if !p.exists() { File::create(p) }` races. Fix: `File::create_new` (1.77) or `OpenOptions::create_new(true)`.
- **Non-atomic replace**: rewriting config/state in place → readers and crashes see partial content. Fix: temp file in the same directory, `sync_all`, `fs::rename` (e.g. `NamedTempFile::persist`).
- **Predictable temp paths**: `env::temp_dir().join("app.tmp")` → symlink attacks and collisions between processes. Fix: the `tempfile` crate.
- **Permissions after creation**: `File::create` then `set_permissions(0o600)` leaves secrets readable in between. Fix: `OpenOptionsExt::mode(0o600)` at open.
