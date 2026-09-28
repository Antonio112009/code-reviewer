---
name: Path traversal, archives and temp files
description: File-system access from user-influenced names — File/Path.resolve without containment checks, absolute-path resolve, string-prefix checks, Zip Slip and zip bombs, upload file names, insecure temp files and symlink races.
priority: 76
tags: [CWE-22, CWE-377, CWE-409, A01:2025]
activation:
  content:
    - '\bnew\s+File\('
    - '\b(?:Paths\.get|Path\.of)\('
    - '\.resolve(?:Sibling)?\('
    - '\b(?:ZipInputStream|ZipFile|ZipEntry|JarFile|JarInputStream|TarArchiveInputStream|ArchiveEntry)\b'
    - '\b(?:getOriginalFilename|getSubmittedFileName)\('
    - '\bcreateTemp(?:File|Directory)\('
  examples:
    - 'File target = new File(uploadDir, fileName);'
    - 'Path path = Paths.get(baseDir, userInput);'
    - 'Path resolved = base.resolve(userInput);'
    - 'ZipEntry entry = zipInputStream.getNextEntry();'
    - 'String name = file.getOriginalFilename();'
    - 'File tmp = File.createTempFile("upload", ".tmp");'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html
  - https://owasp.org/www-community/attacks/Path_Traversal
  - https://security.snyk.io/research/zip-slip-vulnerability
---
- **Unchecked joins**: `new File(baseDir, name)` or `base.resolve(name)` with request, header, DB or archive data → `../` escapes the base directory. Fix: `resolve(name).normalize()`, then verify it `startsWith(base)`.
- **Absolute override**: `Path.resolve(other)` returns `other` itself when it is absolute (`/etc/passwd`, `C:\…`) → the base is ignored. Fix: reject absolute input before resolving.
- **String prefix checks**: `path.startsWith(baseString)` on strings or un-normalized `getAbsolutePath()` → `/data/app-evil` passes a `/data/app` check and `..` survives. Fix: compare normalized `Path`s (element-wise) or `toRealPath()`.
- **Zip Slip / zip bombs**: extracting to `entry.getName()` overwrites arbitrary files; unlimited entry count or sizes exhaust disk and memory. Fix: validate each resolved target; cap entries and bytes.
- **Upload names**: `MultipartFile.getOriginalFilename()`/`Part.getSubmittedFileName()` used in paths → traversal and overwrites. Fix: server-generated names; keep the original as metadata only.
- **Temp files and links**: predictable names in shared `/tmp`, `File.createTempFile` (more permissive than `Files.createTempFile`) or check-then-open on possible symlinks → local users read or hijack files. Fix: `Files.createTempFile`/`createTempDirectory`, `NOFOLLOW_LINKS`.
