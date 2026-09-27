---
name: Decompression bombs and attacker-sized allocations
description: Unbounded reads from gzip/zlib/zip readers, allocations sized by headers or length prefixes, image dimension bombs and whole-input collection of uploads and streams.
priority: 70
tags: [CWE-409, CWE-789, CWE-400]
activation:
  content:
    - '\b(?:gzip|zlib|flate|lzw|bzip2|zstd)\.NewReader\b'
    - '\bzip\.(?:NewReader|OpenReader)\b'
    - '\bio\.(?:ReadAll|Copy|CopyN)\('
    - '\bimage\.(?:Decode|DecodeConfig)\b|\b(?:png|jpeg|gif|webp)\.Decode\('
    - '\bmake\(\s*\[\][\w.]{1,30}\s*,\s*[a-z]\w{0,30}'
    - '\bcsv\.NewReader\b|\bUncompressedSize(?:64)?\b'
sources:
  - https://pkg.go.dev/compress/gzip#NewReader
  - https://pkg.go.dev/archive/zip#FileHeader
  - https://pkg.go.dev/image#DecodeConfig
  - https://pkg.go.dev/io#LimitReader
---
- **Decompression bombs**: `io.ReadAll`/`io.Copy` from `gzip.NewReader`, zlib/flate readers, `zip.File.Open` or gzip-encoded request bodies without a byte cap → kilobytes expand to gigabytes (memory/disk exhaustion). Fix: `io.LimitReader(r, max+1)` and reject when more arrives.
- **Declared sizes**: `zip.FileHeader.UncompressedSize64`, `Content-Length` or length prefixes in custom protocols used for `make([]byte, n)` or quotas are attacker-controlled. Fix: cap `n` before allocating; count actual bytes.
- **Image bombs**: `image.Decode` of uploads allocates width×height×4 bytes before any check → a small PNG/JPEG can demand gigabytes. Fix: `image.DecodeConfig` first and limit pixel counts.
- **Unbounded collections**: `csv.Reader.ReadAll`, reading all lines/records, or decoding JSON arrays from uploads into memory without count limits → OOM. Fix: stream records with counters and limits.
- **Archive totals**: zip/tar extraction without limits on entry count and total size, or nested archives extracted recursively → disk exhaustion. Fix: cap entries, total bytes and nesting depth.
