---
name: File paths and archives
description: Path traversal in .NET file APIs — Path.Combine with rooted or dot-dot input, broken StartsWith containment checks, Zip Slip in manual archive extraction, decompression bombs and user-supplied file names used for storage.
priority: 74
tags: [CWE-22, CWE-23, CWE-409, A01:2025]
activation:
  content:
    - '\bPath\.(?:Combine|Join|GetFullPath|GetFileName|GetRelativePath)\('
    - '\bFile\.(?:ReadAll\w*|WriteAll\w*|Open\w*|Delete|Copy|Move|Create)\(|\bnew\s+FileStream\(|\bDirectory\.(?:Delete|GetFiles|EnumerateFiles)\('
    - '\bZipArchive\b|\bZipFile\.|\bExtractToFile\(|\bTarReader\b|\bTarFile\.'
sources:
  - https://learn.microsoft.com/en-us/dotnet/api/system.io.path.combine
  - https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.zipfileextensions.extracttofile
  - https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.zipfile.extracttodirectory
---
- **Path.Combine with input**: `Path.Combine(baseDir, userPath)` returns `userPath` unchanged when it is rooted (`/etc/passwd`, `C:\…`, `\\server\share`) and keeps `..` segments → reads/writes outside the base. `Path.Join` doesn't reset on rooted parts but still keeps `..`. Fix: `Path.GetFullPath(Path.Join(base, name))`, then a containment check.
- **Broken containment check**: `full.StartsWith(baseDir)` without a trailing separator (`/data/app` accepts `/data/app-secrets`), checking before normalization, wrong case sensitivity, or ignoring symlinks → bypass. Fix: normalize both, append `Path.DirectorySeparatorChar`, compare with the file system's casing rules.
- **Zip Slip**: loops over `ZipArchive.Entries`/`TarReader` writing to `Path.Combine(dest, entry.FullName)` or calling `entry.ExtractToFile(...)` unchecked → `../` entries overwrite files (`ZipFile.ExtractToDirectory` checks; manual loops don't). Fix: validate every resolved path.
- **Decompression bombs**: extracting or reading archives without limits on entry count, total uncompressed bytes or ratio → disk/memory exhaustion. Fix: cap sizes while copying, not from header values.
- **User-named files**: client-supplied names (upload names, `Content-Disposition`, URL segments) used as storage names → traversal, overwrites, reserved Windows names (`CON`, `NUL`), dangerous extensions. Fix: `Path.GetRandomFileName()` for storage, keep the display name separately.
