---
name: io readers, writers and file writes
description: io.Reader short reads, bufio.Scanner token limits, unflushed compress/buffered writers, lost Close errors, non-atomic file writes, decimal permission literals and silent LimitReader truncation.
priority: 58
tags: [CWE-252, CWE-732, CWE-367]
activation:
  content:
    - '\.Read\(\s*\w{1,30}\s*\)'
    - '\bbufio\.(?:NewScanner|NewReader|NewWriter|Scanner|Writer)\b'
    - '\bio\.(?:ReadFull|ReadAll|Copy\w{0,6}|LimitReader|Pipe)\b'
    - '\bos\.(?:WriteFile|Create\w{0,4}|OpenFile|Rename|Mkdir\w{0,3}|Chmod)\b'
    - '\b(?:gzip|zlib|flate|zip|tar|csv)\.New(?:Writer|Reader)\b'
  examples:
    - 'n, err := conn.Read(buf)'
    - 'scanner := bufio.NewScanner(f)'
    - 'if _, err := io.Copy(dst, src); err != nil {'
    - 'os.WriteFile(path, data, 0o644)'
    - 'gw := gzip.NewWriter(f)'
sources:
  - https://pkg.go.dev/io#Reader
  - https://pkg.go.dev/bufio#Scanner
  - https://pkg.go.dev/compress/gzip#Writer.Close
  - https://pkg.go.dev/os#WriteFile
---
- **Short reads**: `r.Read(buf)` may return fewer bytes than asked, or data together with `io.EOF` → dropped tails, truncated frames. Fix: handle `buf[:n]` before `err`; `io.ReadFull` for fixed sizes.
- **Scanner limit**: `bufio.Scanner` stops on tokens over 64 KiB and reports `ErrTooLong` only via `Err()` → loops without the check truncate input silently. Fix: check `Err()`, raise `sc.Buffer`.
- **Unflushed writers**: gzip/zlib/zip/tar writers, `bufio.Writer` and `csv.Writer` buffer data → a missing or unchecked `Close`/`Flush` yields truncated output. Fix: close/flush and check errors before using the bytes.
- **Lost write errors**: `defer f.Close()` on written files drops the error where disk-full/NFS failures surface; no `f.Sync()` before rename → data loss after a crash. Fix: check `Close`.
- **Non-atomic replace**: `os.WriteFile`/`os.Create` truncate then write → readers or a crash see partial config/state. Fix: temp file in the same dir, `Sync`, `os.Rename`.
- **Decimal permissions**: `os.WriteFile(p, b, 644)` or `MkdirAll(d, 755)` are decimal (644 = 0o1204) → wrong modes; secrets written `0o644` are world-readable. Fix: `0o600`/`0o644`.
- **LimitReader truncation**: `io.LimitReader(r, n)` returns EOF at `n` → oversized input is accepted as complete. Fix: read `n+1` bytes and reject when exceeded.
