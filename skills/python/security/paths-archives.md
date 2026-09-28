---
name: Paths, archives and temp files
description: Path traversal with os.path.join/pathlib absolute segments, broken containment checks, tarfile extraction without filter (default "data" only from 3.14), manual zip extraction (Zip Slip), decompression bombs, predictable temp names and permissive modes.
priority: 78
tags: [CWE-22, CWE-59, CWE-409, CWE-377, CWE-732, OWASP-A01]
activation:
  content:
    - "\\bos\\.path\\.join\\s*\\(|\\bPath\\s*\\([^)\\n]{0,80}\\)\\s*/\\s*\\w|\\b(?:is_relative_to|commonpath|realpath|resolve)\\s*\\("
    - "\\b(?:extractall|extract|unpack_archive)\\s*\\(|\\btarfile\\.open\\s*\\(|\\bZipFile\\s*\\(|\\binfolist\\s*\\(\\s*\\)"
    - "\\b(?:gzip|bz2|lzma|zlib)\\.(?:decompress|open)\\s*\\("
    - "\\btempfile\\.mktemp\\s*\\(|[\"']/tmp/[^\"'\\n]{1,80}[\"']|\\bos\\.chmod\\s*\\([^)\\n]{1,80}0o?7[0-7]{2}"
  examples:
    - 'path = os.path.join(base_dir, user_filename)'
    - 'tar.extractall(dest)'
    - 'data = gzip.decompress(payload)'
    - 'path = tempfile.mktemp()'
sources:
  - https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.is_relative_to
  - https://docs.python.org/3/library/tarfile.html#tarfile-extraction-filter
  - https://docs.python.org/3/library/zipfile.html#zipfile.ZipFile.extractall
  - https://docs.python.org/3/library/tempfile.html#tempfile.mktemp
---
- **Absolute segments reset the base**: `os.path.join(base, user)` and `base / user` return `user` itself when it is absolute (`/etc/passwd`, `C:\…`) → reads and writes anywhere. Fix: reject absolute input, then check containment.
- **Broken containment checks**: `".." not in p`, `normpath`, `str(p).startswith(base)` (matches `/data2` for `/data`) and `is_relative_to()` without `resolve()` (string-based, ignores `..` and symlinks). Fix: `(base / p).resolve().is_relative_to(base.resolve())`.
- **tarfile without a filter**: `extractall()`/`extract()`/`shutil.unpack_archive()` honour absolute names, `..`, symlinks and devices unless `filter="data"` (3.12+ and security releases; default only since 3.14) → arbitrary overwrite. Fix: `filter="data"`.
- **Manual zip extraction**: `ZipFile.extractall()` sanitizes names, but looping `infolist()` and writing to `os.path.join(dest, info.filename)` doesn't → Zip Slip. Fix: resolve-and-contain per member.
- **Decompression bombs**: unbounded extraction, member `read()` or `gzip`/`bz2`/`lzma` decompression of uploads fills disk or memory. Fix: cap `file_size` sums and member counts.
- **Predictable temp files**: `tempfile.mktemp()` or fixed `/tmp/...` names → symlink and race attacks. Fix: `mkstemp`, `TemporaryDirectory`.
- **Permissive modes**: `os.chmod(p, 0o777)` or secrets written with the default umask are readable by other users. Fix: `os.open(p, flags, 0o600)`.
