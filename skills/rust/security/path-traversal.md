---
name: Path traversal and archive extraction
description: Filesystem paths built from input in Rust — Path::join replacing the base with absolute paths, string prefix checks, symlink/TOCTOU races, zip-slip with tar/zip crates, hand-rolled static file serving and Windows path forms.
priority: 72
tags: [CWE-22, CWE-23, CWE-59, CWE-367]
activation:
  content:
    - '(?:[Pp]ath|[Dd]ir|[Rr]oot|[Bb]ase|[Uu]pload|[Ss]tatic)\w*\s*\.join\('
    - '\bPathBuf::from\(|\bPath::new\(|\bcanonicalize\(|\bstrip_prefix\('
    - '\bunpack(?:_in)?\(|\b(?:enclosed|mangled)_name\(|\bZipArchive\b|\btar::Archive\b'
    - '\bNamedFile::open|\bServeDir\b|\bServeFile\b|\bactix_files\b'
  examples:
    - 'let full_path = base_dir.join(&user_supplied);'
    - 'let canonical = path.canonicalize()?;'
    - 'let mut archive = ZipArchive::new(file)?;'
    - 'let file = NamedFile::open(format!("static/{tail}"))?;'
sources:
  - https://doc.rust-lang.org/std/path/struct.Path.html#method.join
  - https://docs.rs/tar/latest/tar/struct.Entry.html#method.unpack_in
  - https://docs.rs/zip/latest/zip/read/struct.ZipFile.html#method.enclosed_name
  - https://actix.rs/docs/static-files
---
- **`Path::join` with input**: an absolute component replaces the base (`base.join("/etc/passwd")` is `/etc/passwd`) and `..` is kept as-is; percent-decoded route params and archive entry names are typical sources. Fix: accept only `Component::Normal` parts, reject `..`, roots and prefixes.
- **Prefix checks on strings**: `path.to_str().starts_with(base)` accepts `/srv/app2/..`; `Path::starts_with` on un-normalized paths accepts `base/../..`. Fix: canonicalize existing paths, then component-wise `Path::starts_with`.
- **Symlinks and TOCTOU**: check-then-open on writable directories races with symlink swaps; following symlinks out of upload dirs. Fix: open relative to a directory handle (`cap-std`, `O_NOFOLLOW`), refuse symlinks.
- **Archive extraction (zip-slip)**: `tar::Entry::unpack(dst.join(entry.path()?))` or `zip` `file.name()` used as a path → writes anywhere. Fix: `Entry::unpack_in`/`Archive::unpack`, `ZipFile::enclosed_name()`, skip symlink entries.
- **Hand-rolled file serving**: `NamedFile::open(format!("static/{}", tail))` with `{tail:.*}` or `fs::read(dir.join(param))` → arbitrary file read. Fix: `tower_http::services::ServeDir` or `actix_files::Files`.
- **Windows forms**: `\` separators, drive letters, UNC paths and device names (`CON`, `NUL`) slip past checks written for `/`. Fix: component-based validation on the target platform.
