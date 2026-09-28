---
name: File inclusion, paths and XML entities
description: Dynamic include/require, path traversal in file functions, broken realpath prefix checks, stream wrappers in user paths, archive extraction and libxml flags that re-enable XXE.
priority: 78
tags: [CWE-98, CWE-22, CWE-73, CWE-611]
activation:
  content:
    - '\b(?:include|require)(?:_once)?\b[^;\n]{0,80}\$'
    - '\b(?:file_get_contents|readfile|fopen|file|unlink|file_put_contents|copy|rename|fpassthru|scandir)\s*\([^)\n]{0,80}\$'
    - '\brealpath\s*\(|php://|phar://|data://|zip://|->(?:getNameIndex|statIndex|getStream)\s*\('
    - '\bLIBXML_(?:NOENT|DTDLOAD|DTDATTR|PARSEHUGE)\b'
  examples:
    - 'include "lang/" . $lang . ".php";'
    - '$contents = file_get_contents($path);'
    - '$real = realpath($path);'
    - '$dom->loadXML($xml, LIBXML_NOENT | LIBXML_DTDLOAD);'
sources:
  - https://www.php.net/manual/en/function.include.php
  - https://www.php.net/manual/en/wrappers.php
  - https://www.php.net/manual/en/function.realpath.php
  - https://www.php.net/manual/en/libxml.constants.php
---
- **Dynamic include**: `include`/`require` of a path built from input (`"lang/$lang.php"`, template names) → local file inclusion, and `php://filter` chains reach RCE without any upload. Fix: map ids to a fixed list of files.
- **Path traversal**: input concatenated into `file_get_contents`, `readfile`, `fopen`, `unlink`, `file_put_contents` paths → `../` reads `.env` or deletes arbitrary files. Fix: `basename()` for file names, or resolve and check the prefix.
- **Prefix check bugs**: `str_starts_with(realpath($p), $base)` without a trailing separator also accepts `/var/app/uploads-old/…`; `realpath()` returns `false` for missing files. Fix: compare with `rtrim($base, '/') . '/'`, handle `false`.
- **Stream wrappers**: file functions accept `php://`, `phar://`, `data://`, `zip://`, `glob://` and remote URLs when `allow_url_fopen` is on → a user "path" becomes disclosure, SSRF or deserialization. Fix: reject `://`, prefix a fixed directory.
- **Archive extraction**: loops that write entries under their `getNameIndex()`/`statIndex()` names (unlike `ZipArchive::extractTo()`, which strips `../`) → zip slip writes outside the target; unchecked sizes → zip bombs. Fix: validate names and sizes.
- **XXE flags**: `LIBXML_NOENT`, `LIBXML_DTDLOAD` or `LIBXML_DTDATTR` on untrusted XML re-enable entity loading (disabled by default since PHP 8.0/libxml 2.9) → local file disclosure, SSRF; `LIBXML_PARSEHUGE` enables billion-laughs DoS.
