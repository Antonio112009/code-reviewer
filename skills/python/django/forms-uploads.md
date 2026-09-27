---
name: Forms and file uploads
description: Django form and upload defects — ModelForm mass assignment, validation skipped for excluded fields, lost M2M data with commit=False, trusted hidden inputs, missing upload size limits, client-supplied file metadata and user-controlled storage paths.
priority: 66
tags: [CWE-915, CWE-434, CWE-22, A01:2025]
activation:
  files: ["**/forms.py", "**/forms/*.py"]
  content:
    - '\bforms\.(?:Model)?Form\b|\bModelForm\b'
    - '\b(?:commit\s*=\s*False|save_m2m|cleaned_data)\b'
    - '\b(?:request\.FILES|UploadedFile|FileField|ImageField|upload_to|FileResponse|default_storage)\b'
    - '\b(?:DATA_UPLOAD_MAX_\w+|FILE_UPLOAD_\w+)\b'
sources:
  - https://docs.djangoproject.com/en/stable/topics/forms/modelforms/
  - https://docs.djangoproject.com/en/stable/ref/forms/fields/#disabled
  - https://docs.djangoproject.com/en/stable/topics/security/#user-uploaded-content
  - https://docs.djangoproject.com/en/stable/ref/settings/#data-upload-max-memory-size
---
- **Mass assignment**: `fields = "__all__"` or `exclude = [...]` makes every new model field (`is_staff`, `owner`, `price`) editable automatically. Fix: explicit `fields`.
- **Excluded fields skip validation**: model validators and unique checks do not run for fields missing from the form; values set later in the view go unvalidated → `IntegrityError` or bad data. Fix: validate them yourself (`obj.full_clean()` before saving).
- **Overridden clean()**: `ModelForm.clean()` without `super().clean()` loses unique/unique_together validation. Fix: call the parent.
- **commit=False**: `form.save(commit=False)` + `obj.save()` without `form.save_m2m()` silently drops M2M data.
- **Trusted hidden inputs**: prices, owners or IDs round-tripped in hidden fields, or `request.POST` read after validation instead of `cleaned_data` → tampering. Fix: `disabled=True` fields or server-side values.
- **No upload size cap**: `DATA_UPLOAD_MAX_MEMORY_SIZE` excludes file data and `FILE_UPLOAD_MAX_MEMORY_SIZE` only chooses memory vs temp file (ASGI spools the whole body) → disk/memory DoS. Fix: web-server limit plus a size validator.
- **Client-supplied metadata**: `UploadedFile.content_type`/`name` are attacker-controlled; `ImageField` accepts HTML polyglots → stored XSS when MEDIA is served from the app's origin. Fix: separate media domain, `Content-Disposition: attachment`.
- **User-controlled paths**: `upload_to` or `storage.save()` names from input, `FileResponse(open(base + name))` → traversal or overwrites. Fix: generated names, lookup by database id.
