---
name: Dumping, copying and parsing
description: Pydantic v2 data-flow defects — model_dump() objects that json.dumps cannot encode, secrets in reprs and error messages, by_alias defaults, masked SecretStr values persisted, unvalidated model_copy/model_construct data, from_attributes triggering lazy loads and TypeAdapter rebuilt per call.
priority: 62
tags: [CWE-20, CWE-200]
activation:
  content:
    - '\.model_dump(?:_json)?\(|\.dict\(|\.json\('
    - '\b(?:by_alias|serialize_by_alias|model_copy|model_construct|construct|hide_input_in_errors|ValidationError)\b'
    - '\b(?:SecretStr|SecretBytes|Secret\[|get_secret_value)\b'
    - '\b(?:from_attributes|orm_mode|model_validate|from_orm|TypeAdapter)\b'
  examples:
    - 'payload = model.model_dump(mode="json")'
    - 'updated = model.model_copy(update={"name": "x"})'
    - 'token: SecretStr = Field(...)'
    - 'user = User.model_validate(orm_obj, from_attributes=True)'
sources:
  - https://docs.pydantic.dev/latest/concepts/serialization/
  - https://docs.pydantic.dev/latest/concepts/models/
  - https://docs.pydantic.dev/latest/concepts/performance/
  - https://docs.pydantic.dev/latest/api/types/#pydantic.types.SecretStr
---
- **Python-mode dumps**: `model_dump()` keeps `datetime`, `UUID`, `Decimal` and enums as objects → `json.dumps(model.model_dump())` raises `TypeError`. Fix: `model_dump(mode="json")` or `model_dump_json()`.
- **Secrets in reprs and errors**: `repr(model)` and logged models print every field unless `Field(repr=False)` or `SecretStr`; `ValidationError` text includes `input_value=...` → secrets and PII in logs. Fix: `hide_input_in_errors=True` where inputs are sensitive.
- **Alias mismatch**: `model_dump()` uses field names unless `by_alias=True`, while FastAPI responses use aliases → payloads, caches or messages disagree on keys.
- **Masked secrets persisted**: `SecretStr` dumps as a `SecretStr` object in Python mode and `"**********"` in JSON mode → the mask gets written to config, DB or outbound requests. Fix: `get_secret_value()` exactly where the secret is needed.
- **Unvalidated copies**: `model_copy(update={...})` and `model_construct()` skip validation → wrong types or unchecked user input inside a "valid" model. Fix: `model_validate({**m.model_dump(), **changes})`.
- **from_attributes and ORM objects**: `model_validate(orm_obj)` with `from_attributes=True` reads every declared relationship → lazy-load N+1, or `MissingGreenlet` with async SQLAlchemy. Fix: eager-load exactly the fields the schema declares.
- **Parsing cost**: `TypeAdapter(...)` built inside a function rebuilds its validator per call, and `model_validate(json.loads(s))` is slower than `model_validate_json(s)`. Fix: module-level adapters.
