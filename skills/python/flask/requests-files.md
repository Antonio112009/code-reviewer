---
name: Request data, uploads and file serving
description: Flask/Werkzeug request-handling defects — get_json() status codes by version, silent=True returning None, force=True enabling cross-site JSON, request.values mixing query and form, unlimited bodies, empty secure_filename() results and user paths in send_file().
priority: 68
tags: [CWE-22, CWE-400, CWE-352, CWE-434]
activation:
  content:
    - '\brequest\.(?:get_json|json|values|form|args|files|data|get_data|stream)\b'
    - '\b(?:secure_filename|send_file|send_from_directory|safe_join)\('
    - '\.save\([^)\n]{0,120}\bfilename\b'
    - '\b(?:MAX_CONTENT_LENGTH|MAX_FORM_MEMORY_SIZE|MAX_FORM_PARTS|max_content_length)\b'
sources:
  - https://flask.palletsprojects.com/en/stable/patterns/fileuploads/
  - https://flask.palletsprojects.com/en/stable/web-security/#resource-use
  - https://werkzeug.palletsprojects.com/en/stable/utils/#werkzeug.utils.secure_filename
  - https://werkzeug.palletsprojects.com/en/stable/changes/
---
- **get_json() errors by version**: a non-JSON `Content-Type` raises 415 (Werkzeug 2.3+, 400 in 2.1–2.2) and invalid JSON 400; handlers expecting `None` never see it, and clients sending form posts get opaque errors.
- **silent=True**: `get_json(silent=True)` returns `None` on missing or bad JSON → `data["key"]` raises `TypeError` (500). Fix: check for `None` and return 400.
- **force=True enables CSRF**: `get_json(force=True)` parses bodies sent as `text/plain`, which browsers send cross-site without preflight → cookie-authenticated JSON endpoints become CSRF-able.
- **request.values mixes sources**: it merges query string and form data, so state-changing handlers reading it accept parameters from a plain GET link. Fix: read `request.form` in POST handlers.
- **Unlimited bodies**: `MAX_CONTENT_LENGTH` defaults to `None`; only non-file form fields are capped (`MAX_FORM_MEMORY_SIZE` 500 kB and `MAX_FORM_PARTS` 1000 since Flask/Werkzeug 3.1) → large uploads fill memory or disk. Fix: set `MAX_CONTENT_LENGTH`.
- **Upload names**: `file.save(os.path.join(UPLOAD_DIR, file.filename))` → traversal/overwrite; `secure_filename()` can return `""`, saving to the directory itself or colliding. Fix: generated unique names.
- **User paths in send_file()**: `send_file(os.path.join(base, name))` or `send_file(request.args["path"])` → arbitrary file read. Fix: `send_from_directory(base, name)`; serve uploads with `as_attachment=True` to avoid HTML/SVG XSS.
