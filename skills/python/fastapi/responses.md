---
name: Response models and partial updates
description: FastAPI response defects — ORM objects or dicts returned without a filtering response model, Response objects that bypass validation and filtering, PATCH handlers resetting omitted fields, Starlette 1.0 template autoescaping and response validation errors surfacing as 500s.
priority: 66
tags: [CWE-200, CWE-915]
activation:
  content:
    - '\bresponse_model\w*\s*='
    - '\b(?:JSONResponse|ORJSONResponse|UJSONResponse|HTMLResponse|Response|StreamingResponse)\(|\bResponseValidationError\b'
    - '->\s*(?:dict|Any|list\[dict|JSONResponse)\b'
    - '@\w+\.patch\(|\bexclude_unset\s*=|\bmodel_copy\(\s*update\s*='
    - '\bJinja2Templates\(|\bTemplateResponse\('
  examples:
    - '@app.get("/users/{user_id}", response_model=UserOut)'
    - 'return JSONResponse(content=data)'
    - 'def get_user(user_id: int) -> dict:'
    - 'updated = item.model_dump(exclude_unset=True)'
    - 'templates = Jinja2Templates(directory="templates")'
sources:
  - https://fastapi.tiangolo.com/tutorial/response-model/
  - https://fastapi.tiangolo.com/advanced/response-directly/
  - https://fastapi.tiangolo.com/tutorial/body-updates/
  - https://starlette.dev/release-notes/
---
- **Unfiltered output**: returning ORM objects or dicts with no `response_model` or a `-> dict`/`Any` annotation serializes every attribute (`hashed_password`, internal flags). Fix: dedicated output models as return type or `response_model`.
- **Response bypasses the model**: returning `JSONResponse(...)` or any `Response` skips `response_model` validation and field filtering → leaks and unvalidated shapes. Fix: return data and let FastAPI serialize it.
- **Wrong model wins**: when both a return annotation and `response_model=` are given, `response_model` is used; an input model reused as output echoes write-only fields back.
- **PATCH resets fields**: applying `item.model_dump()` without `exclude_unset=True` (or `model_copy(update=...)` fed with defaults) overwrites omitted fields with defaults or `None`. Fix: `model_dump(exclude_unset=True)` plus an allowlist of writable fields.
- **Templates not escaped (Starlette 1.0+)**: `Jinja2Templates(directory=...)` now uses `select_autoescape()`, which escapes only `.html`, `.htm` and `.xml` templates (before 1.0 all were escaped) → `.jinja`/`.j2` pages are XSS-prone. Fix: `.html` names or your own `Environment`.
- **Invalid responses are 500s**: returned data that does not match the response model (`None` from a failed lookup, a missing required field) raises `ResponseValidationError` → 500 instead of a 404/4xx. Fix: raise `HTTPException` before returning, or model the optional case.
