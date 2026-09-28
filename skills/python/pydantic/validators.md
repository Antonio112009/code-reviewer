---
name: Validators
description: Pydantic v2 validator defects — missing returns that set fields or models to None, info.data lookups for failed or later fields, assert-based checks stripped by -O, exceptions that escape as 500s, unvalidated defaults and assignments, and v1 validator options that no longer exist.
priority: 64
tags: [CWE-20, CWE-617]
activation:
  content:
    - '@(?:field_validator|model_validator|validator|root_validator)\b'
    - '\b(?:BeforeValidator|AfterValidator|WrapValidator|PlainValidator|ValidationInfo)\b'
    - '\b(?:validate_default|validate_assignment|each_item|skip_on_failure)\b'
    - '\binfo\.data\b'
  examples:
    - '@field_validator("email")'
    - 'def normalize(v: str, info: ValidationInfo) -> str:'
    - 'model_config = ConfigDict(validate_assignment=True)'
    - 'password = info.data["password"]'
sources:
  - https://docs.pydantic.dev/latest/concepts/validators/
  - https://docs.pydantic.dev/latest/migration/#changes-to-validators
  - https://docs.pydantic.dev/latest/concepts/fields/#validate-default-values
  - https://github.com/pydantic/pydantic/blob/main/pydantic/main.py
---
- **Missing return**: a field validator without `return value` sets the field to `None`; an `@model_validator(mode="after")` without `return self` only warns in `Model(...)` but makes `model_validate()` (and FastAPI bodies) return `None`.
- **info.data gaps**: `info.data` holds only fields defined earlier that passed validation → `info.data["password"]` raises `KeyError` when that field failed or comes later. Fix: `.get()`, field order, or an after model validator.
- **Exceptions that escape**: only `ValueError`, `AssertionError` and `PydanticCustomError` become `ValidationError`; `KeyError`, `TypeError` (no longer converted in v2) or lookups that fail propagate → 500 instead of 422.
- **assert as validation**: `assert` checks inside validators disappear under `python -O` → invalid data accepted. Fix: `raise ValueError(...)`.
- **Defaults not validated**: defaults skip validation unless `validate_default=True`, so a wrong-typed or out-of-range default passes silently.
- **Assignments not validated**: `model.x = value` is not validated unless `validate_assignment=True` → invalid state after mutation.
- **Before validators see raw input**: `mode="before"` gets whatever the caller sent (str, dict, ORM object); assuming the annotated type raises `AttributeError`/`TypeError` (500).
- **Lossy migration of v1 options**: rewriting `@validator(pre=True, always=True, each_item=True)` as a plain `@field_validator` silently drops pre-parsing, default validation and per-item checks. Fix: `mode="before"`, `validate_default=True`, `Annotated` item validators.
