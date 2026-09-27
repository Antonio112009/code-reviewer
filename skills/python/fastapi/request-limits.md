---
name: Request bodies, uploads and limits
description: FastAPI/Starlette input-size and upload defects — no request body limit by default, whole-file reads of UploadFile, multipart limits, client filenames and path parameters reaching the filesystem, and strict_content_type (0.132) disabled.
priority: 68
tags: [CWE-400, CWE-22, CWE-352]
activation:
  content:
    - '\b(?:UploadFile|File\(|Form\(|request\.form\(|request\.body\(|request\.stream\()'
    - '\.filename\b|\bFileResponse\(|\bStaticFiles\('
    - '\{\w+:path\}'
    - '\bstrict_content_type\s*=|\bmax_body_size\s*='
    - '\b(?:str|bytes|list\[\w+\])\s*=\s*(?:Body|Query|Form)\('
sources:
  - https://fastapi.tiangolo.com/tutorial/request-files/
  - https://fastapi.tiangolo.com/advanced/strict-content-type/
  - https://starlette.dev/requests/
  - https://starlette.dev/release-notes/
---
- **No body limit**: FastAPI sets no maximum request size; JSON bodies and uploads are read fully (Starlette 1.6 added `max_body_size`, not exposed by `FastAPI()` as of 0.141) → memory/disk DoS. Fix: limit at the proxy or with ASGI middleware.
- **Whole-file reads**: `await file.read()` loads the entire upload into memory. Fix: read in chunks with a running size check, reject early.
- **Multipart limits**: `request.form()` defaults to `max_files=1000`, `max_fields=1000` and 1 MB per non-file field; file parts have no size cap, and Starlette <1.3.1 did not enforce `max_fields`/`max_part_size` for URL-encoded forms.
- **Client filenames**: `UploadFile.filename` joined into a path (`os.path.join(UPLOAD_DIR, file.filename)`) → traversal or overwrite. Fix: generated names; store the original only as metadata.
- **Path converters**: `{file_path:path}` parameters passed to `FileResponse`/`open()` allow `../` traversal. Fix: resolve and check `is_relative_to(base)`, or `StaticFiles`.
- **strict_content_type disabled (0.132+)**: `strict_content_type=False`, or FastAPI <0.132, parses JSON bodies without a JSON `Content-Type` → browsers can send them cross-site without preflight (CSRF on unauthenticated local/intranet APIs).
- **Unbounded fields**: `str`, `bytes` and `list` inputs without limits let one request allocate huge objects. Fix: `Field(max_length=...)` on strings and lists.
