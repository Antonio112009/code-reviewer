---
name: pydantic-settings configuration
description: pydantic-settings defects — BaseSettings imported from pydantic in v2, source precedence, extra="forbid" crashing on stray .env keys, case-insensitive names, empty variables overriding defaults, JSON-only complex values, env_prefix ignored for aliases and import-time settings.
priority: 62
tags: [CWE-532, CWE-16]
activation:
  content:
    - '\b(?:BaseSettings|SettingsConfigDict|pydantic_settings)\b'
    - '\b(?:env_prefix|env_file|env_nested_delimiter|case_sensitive|secrets_dir|env_ignore_empty|env_prefix_target)\b'
  examples:
    - 'class Settings(BaseSettings):'
    - 'model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env")'
sources:
  - https://docs.pydantic.dev/latest/concepts/pydantic_settings/
  - https://docs.pydantic.dev/latest/migration/#basesettings-has-moved-to-pydantic-settings
  - https://github.com/pydantic/pydantic-settings/blob/main/docs/index.md
---
- **Moved package**: in v2 `from pydantic import BaseSettings` fails; settings live in the separate `pydantic-settings` package (FastAPI's `standard` extra installs it, slim installs do not).
- **Source precedence**: init arguments beat environment variables, which beat `.env` values → a stale exported variable silently overrides the file you edited; `.env` is read relative to the working directory, not the module.
- **extra="forbid" by default**: unknown keys in a dotenv file (a typo, a variable for another service) raise `ValidationError` at startup; `extra="ignore"` instead hides misspelled settings.
- **Case-insensitive names**: environment names match case-insensitively unless `case_sensitive=True` (and on Windows always), so `API_KEY` and `api_key` collide.
- **Complex values need JSON**: `list`, `dict` and nested models are parsed from env vars as JSON → `HOSTS=a,b` fails. Fix: JSON values, `env_nested_delimiter`, or a `NoDecode` field with a validator.
- **env_prefix and aliases**: `env_prefix` applies only to field names, not to `alias`/`validation_alias` (unless `env_prefix_target` is changed) → unprefixed variables are read.
- **Empty variables win**: an exported but empty variable (`API_URL=`) is used verbatim and overrides the field default with `""`. Fix: `env_ignore_empty=True` or a validator rejecting empty values.
- **Frozen at import**: a module-level `settings = Settings()` reads the environment once at import → tests and late configuration cannot change it. Fix: a cached `get_settings()` dependency.
