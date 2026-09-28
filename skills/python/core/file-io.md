---
name: Files and paths
description: File-system correctness — non-atomic writes, os.rename portability, csv without newline="", exists-then-create races, whole-file reads, glob vs pathlib differences (3.13 "**" change) and rmtree error handling.
priority: 55
activation:
  content:
    - "\\bopen\\s*\\([^)\\n]{0,160}[\"'](?:w|a|x|r\\+|w\\+|wb|ab|xb|wt|at)[\"']"
    - "\\.write_(?:text|bytes)\\s*\\(|\\bos\\.(?:rename|replace|makedirs|mkdir)\\s*\\(|\\bshutil\\.(?:move|copy\\w*|rmtree)\\s*\\("
    - "\\bcsv\\.(?:reader|writer|DictReader|DictWriter)\\s*\\("
    - "\\.r?glob\\s*\\(|\\bglob\\.i?glob\\s*\\("
    - "\\.(?:exists|is_file|is_dir)\\s*\\(\\s*\\)|\\bos\\.path\\.(?:exists|isfile|isdir)\\s*\\("
    - "\\.read(?:lines|_text|_bytes)?\\s*\\(\\s*\\)"
  examples:
    - 'open(path, "w")'
    - 'os.rename(tmp_path, dest_path)'
    - 'writer = csv.writer(f)'
    - 'for p in root.glob("*.csv"):'
    - 'if not path.exists():'
    - 'data = f.read()'
sources:
  - https://docs.python.org/3/library/os.html#os.replace
  - https://docs.python.org/3/library/csv.html#csv.reader
  - https://docs.python.org/3/library/pathlib.html#pathlib-pattern-language
  - https://docs.python.org/3/library/shutil.html#shutil.rmtree
---
- **Non-atomic writes**: `open(path, "w")` truncates immediately; a crash, exception or concurrent reader mid-write sees an empty or partial config, state or cache file. Fix: write a temp file in the same directory, `flush()` + `os.fsync()`, then `os.replace()`.
- **`os.rename` portability**: it fails on Windows when the target exists, and rename/replace both fail across filesystems (`/tmp` to a volume). Fix: `os.replace` within one filesystem, `shutil.move` across devices.
- **csv without `newline=""`**: files opened without `newline=""` get doubled `\r` on Windows and mis-parse quoted fields containing newlines. Fix: `open(p, "w", newline="", encoding="utf-8")`.
- **Check-then-act on paths**: `if not p.exists(): p.mkdir()` or `exists()` before `open()` races with other processes → FileExistsError/FileNotFoundError. Fix: `mkdir(parents=True, exist_ok=True)`, `open(p, "x")`, handle the exception.
- **Whole-file reads**: `read()`, `readlines()`, `read_text()` on logs, uploads or exports load everything into memory. Fix: iterate lines or chunks; `shutil.copyfileobj`.
- **Glob differences**: `glob.glob` skips dotfiles and needs `recursive=True` for `**`, pathlib doesn't; since 3.13 pathlib patterns ending in `**` also return files → different file sets. Fix: filter with `is_file()`/`is_dir()` explicitly.
- **rmtree errors**: `ignore_errors=True` hides partially deleted trees, and `onerror=` is deprecated since 3.12. Fix: an `onexc=` handler that logs or raises.
