---
name: File uploads in plain PHP
description: Upload handling with $_FILES — client-controlled name and type, extension checks, storage under the web root, image checks that accept polyglots and SVG (8.5), missing error checks, and serving uploads inline.
priority: 76
tags: [CWE-434, CWE-79, CWE-22]
activation:
  content:
    - '\$_FILES\b|\b(?:move_uploaded_file|is_uploaded_file)\s*\('
    - '\b(?:getimagesize|exif_imagetype|mime_content_type|finfo_file)\s*\('
    - '\bUPLOAD_ERR_\w+'
sources:
  - https://www.php.net/manual/en/features.file-upload.php
  - https://www.php.net/manual/en/function.getimagesize.php
  - https://www.php.net/manual/en/migration85.new-features.php
  - https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
---
- **Client metadata**: `$_FILES[…]['type']` and `['name']` come from the client → MIME or extension checks on them are bypassed. Fix: detect with `finfo` on `tmp_name`, generate the stored name yourself.
- **Extension checks**: blocklists, `strpos($name, '.jpg')` or `pathinfo()` on the user name miss `shell.php.jpg`, `.phtml`, `.phar`, `.pht`, `.htaccess`, `.user.ini` → executable uploads. Fix: allowlist, derive the extension from the detected type.
- **Web-root storage**: `move_uploaded_file()` into a directory served with the PHP handler → uploaded code executes; user-chosen names overwrite existing files. Fix: store outside the document root under random names.
- **"It is an image"**: `getimagesize()`/`exif_imagetype()` accept polyglots (valid header plus PHP/HTML payload), and since 8.5 `getimagesize()` also recognises script-capable SVG. Fix: re-encode with GD/Imagick, reject or sanitise SVG.
- **Unchecked upload status**: ignoring `$_FILES[…]['error'] !== UPLOAD_ERR_OK` or `is_uploaded_file()` → empty or partial files processed as valid. Fix: check both before use.
- **Serving uploads inline**: `readfile()` with the stored or client MIME type on your origin → uploaded HTML/SVG becomes stored XSS. Fix: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, a separate domain.
