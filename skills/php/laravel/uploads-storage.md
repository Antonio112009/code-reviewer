---
name: Uploads and Storage disks
description: Laravel file handling — mimes checks content not the user's extension, image allowing SVG before Laravel 12, client original names and extensions, PHP files on the public disk, IDOR on stored paths, download paths built from input.
priority: 72
tags: [CWE-434, CWE-22, CWE-639, CWE-79]
activation:
  content:
    - '->(?:store|storeAs|storePublicly|storePubliclyAs|putFileAs)\s*\(|\bStorage::(?:disk|put|download|url|temporaryUrl)\b'
    - '->getClient(?:OriginalName|OriginalExtension|MimeType)\s*\(|->(?:hashName|extension)\s*\('
    - '[''"|](?:mimes|mimetypes|image|extensions|file):?|\bFile::(?:image|types)\s*\('
    - '\bresponse\(\)->(?:download|file)\s*\('
sources:
  - https://laravel.com/docs/13.x/validation#rule-mimes
  - https://laravel.com/docs/13.x/filesystem#file-uploads
  - https://laravel.com/docs/12.x/upgrade#image-validation
---
- **mimes checks content only**: `mimes:png` accepts PNG bytes named `shell.php`; storing that name keeps `.php`. Fix: add the `extensions` rule and generate names with `hashName()`/`store()`.
- **SVG as image**: before Laravel 12 the `image` rule accepted SVG → script-carrying uploads served from your origin (stored XSS). Laravel 12+ needs `image:allow_svg` to allow them.
- **Client names and types**: `getClientOriginalName()`, `getClientOriginalExtension()`, `getClientMimeType()` are attacker-controlled (documented as unsafe) → overwrites, extension spoofing, path tricks with `storeAs()`. Fix: `hashName()`, `extension()`.
- **Public disk execution**: files on the `public` disk are served through the `public/storage` symlink; a stored `.php`/`.phtml` can hit the PHP handler → RCE. Fix: allowlist extensions, keep sensitive files on private disks.
- **Stored-path IDOR**: `Storage::download($request->input('path'))` or `temporaryUrl()` for any id serves other users' files inside the disk root. Fix: look up the file record and authorize it.
- **Paths outside disks**: `response()->download(storage_path('app/' . $name))` or `response()->file()` with input bypass Flysystem's normalisation → `../` reads `.env`. Fix: resolve through a disk and validate names.
