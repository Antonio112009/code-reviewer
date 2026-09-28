---
name: Path traversal with the path module
description: path.join/resolve with user segments, broken startsWith containment checks, checks before decoding, Windows device names and separators (CVE-2025-27210), and archive extraction (Zip Slip).
priority: 75
tags: [CWE-22, CWE-23, CWE-59, A01:2025]
activation:
  content:
    - '\bpath\.(?:join|resolve|normalize|relative)\s*\('
    - '\bcreate(?:Read|Write)Stream\s*\(|\b(?:readFile|writeFile|appendFile|unlink|rm|mkdir|copyFile|rename)\w*\s*\([^)\n]{0,120}\b(?:req|request|params|query|body|input|name|file(?:name)?)\b'
    - '\b(?:adm-zip|unzipper|yauzl|extract-zip|decompress|tar-fs)\b|\.extractAllTo\s*\(|\bentry\.(?:path|fileName|entryName)\b'
  examples:
    - 'const target = path.join(base, req.params.file);'
    - 'fs.createReadStream(req.query.file);'
    - 'zip.extractAllTo(dest, true);'
sources:
  - https://nodejs.org/api/path.html#pathresolvepaths
  - https://nodejs.org/en/blog/vulnerability/july-2025-security-releases
  - https://owasp.org/www-community/attacks/Path_Traversal
  - https://security.snyk.io/research/zip-slip-vulnerability
---
- **`join`/`resolve` with input**: `path.join(base, req.params.file)` resolves `..` segments; `path.resolve(base, input)` returns `input` itself when it is absolute (`/etc/passwd`, `C:\…`) → reads or writes outside the root. Fix: resolve, then verify containment.
- **Broken containment checks**: `resolved.startsWith(base)` accepts `/srv/app-secrets` for base `/srv/app`; checks on the raw string (`includes('..')`) or before `decodeURIComponent` miss `%2e%2e` and `..\`. Fix: `const rel = path.relative(base, resolved)`; reject if `rel.startsWith('..')` or `path.isAbsolute(rel)`; `fs.realpath` for symlinks.
- **Windows specifics**: backslashes, drive letters, UNC paths and device names (`CON`, `AUX`) bypassed `path.normalize`/`join`-based checks before Node 20.19.4/22.17.1/24.4.1 (CVE-2025-27210). Fix: current Node; reject `\`, `:` and reserved names in file names.
- **Archive extraction (Zip Slip)**: writing entries to `path.join(dest, entry.name)` (adm-zip, unzipper, yauzl, custom tar code) or following symlink entries → overwrite code or config outside `dest`. Fix: validate every entry's resolved path; skip links.
