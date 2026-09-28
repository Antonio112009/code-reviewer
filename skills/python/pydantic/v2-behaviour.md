---
name: v1 → v2 behaviour changes
description: Pydantic v2 semantics that silently differ from v1 — Optional/Any fields now required, stricter int/str coercion, smart unions, subclass fields dropped on dump, URL types that are not str and gain a trailing slash, model equality, the Rust regex engine and pydantic.v1 in FastAPI.
priority: 64
activation:
  content:
    - '\bOptional\[|\|\s*None\b|:\s*Any\b'
    - '\b(?:Union\[|union_mode|SerializeAsAny|serialize_as_any|coerce_numbers_to_str)\b'
    - '\b(?:AnyUrl|HttpUrl|AnyHttpUrl|PostgresDsn|RedisDsn|url_preserve_empty_path)\b'
    - '\bpattern\s*=|\bregex_engine\b|\bpydantic\.v1\b|\bfrom\s+pydantic\.v1\b'
    - '@validator\(|@root_validator\b|\bclass\s+Config\s*:|\.dict\(\)|\.parse_obj\('
  examples:
    - 'age: Optional[int]'
    - 'value: Union[int, str] = Field(union_mode="left_to_right")'
    - 'redirect_uri: HttpUrl'
    - 'code: str = Field(pattern=r"^[A-Z]{3}$")'
    - '@validator("name")'
sources:
  - https://docs.pydantic.dev/latest/migration/
  - https://docs.pydantic.dev/latest/concepts/unions/
  - https://docs.pydantic.dev/latest/concepts/serialization/#subclass-instances-for-fields-of-basemodel-dataclasses-typeddict
  - https://docs.pydantic.dev/latest/api/config/#pydantic.config.ConfigDict.url_preserve_empty_path
---
- **Optional is required**: `x: Optional[int]` (or `int | None`, `Any`) has no default in v2 → payloads omitting it now fail. Fix: `= None` where absence is allowed.
- **Stricter coercion**: floats with a fractional part no longer truncate to `int` (validation error), and `int`/`float`/`Decimal` no longer coerce to `str` unless `coerce_numbers_to_str=True`.
- **Smart unions**: `int | str` keeps `"1"` as `str` (v1 converted it to `1`); left-to-right needs `Field(union_mode="left_to_right")` → changed types in business logic.
- **Subclass fields dropped**: dumping a field declared as `Base` holding a `Child` emits only `Base` fields (v1 emitted all) → lost data; `SerializeAsAny` restores it, which may leak.
- **URLs are not str**: `HttpUrl`/`AnyUrl` values compare unequal to strings and bare hosts gain a trailing slash (`https://a.com` → `https://a.com/`) → broken OAuth `redirect_uri` or signature checks. Fix: `str(url)`; `url_preserve_empty_path=True` (2.12+).
- **Equality**: models never equal dicts, and private attributes now affect `==`.
- **Regex engine**: `Field(pattern=...)` uses Rust `regex`, which rejects look-arounds and backreferences. Fix: rewrite, or `regex_engine="python-re"`.
- **pydantic.v1 shim**: FastAPI 0.128+ dropped `pydantic.v1` models; deprecated v1 methods (`.dict()`, `@validator`) still run with v2 semantics.
