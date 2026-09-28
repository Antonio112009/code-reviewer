---
name: Upgrade traps 5.0–6.1
description: Django 5.0–6.1 changes that break code silently rather than loudly — USE_TZ and DEFAULT_AUTO_FIELD default flips, ignored legacy storage settings, POST-only logout, first()/last() ordering, signed-cookie salts and new database minimums.
priority: 64
activation:
  content:
    - '^[ \t]*(?:USE_TZ|DEFAULT_AUTO_FIELD|DEFAULT_FILE_STORAGE|STATICFILES_STORAGE|STORAGES|SIGNED_COOKIE_LEGACY_SALT_FALLBACK)\s*='
    - '\b(?:get_signed_cookie|set_signed_cookie|LogoutView|logout_then_login)\b'
    - '\.order_by\(\s*\)\s*\.(?:first|last|afirst|alast)\('
    - '\b[Dd]jango\b\s*(?:\[[^\]\n]{0,40}\]\s*)?(?:==|>=|~=|<=|<|>|=\s*["''^~])'
  examples:
    - 'STORAGES = {"default": {"BACKEND": "storages.backends.s3.S3Storage"}}'
    - 'return LogoutView.as_view()'
    - 'latest = Order.objects.order_by().first()'
    - 'django = "^5.0"'
sources:
  - https://docs.djangoproject.com/en/dev/releases/5.0/
  - https://docs.djangoproject.com/en/dev/releases/5.1/
  - https://docs.djangoproject.com/en/dev/releases/6.0/
  - https://docs.djangoproject.com/en/dev/releases/6.1/
---
- **USE_TZ default flip (5.0)**: projects that never set `USE_TZ` switch to aware datetimes → naive/aware comparisons raise `TypeError`; on MySQL/SQLite/Oracle, rows stored in local time are read as UTC. Fix: set `USE_TZ` explicitly before upgrading.
- **DEFAULT_AUTO_FIELD default (6.0)**: now `BigAutoField`; apps without an explicit setting or `AppConfig.default_auto_field` get migrations that rewrite PK and FK columns → long locks on big tables. Fix: pin the old value or plan the migration.
- **Legacy storage settings ignored (5.1+)**: `DEFAULT_FILE_STORAGE`/`STATICFILES_STORAGE` were removed, so leftover values are silently ignored → uploads land on local disk instead of S3/GCS. Fix: `STORAGES = {"default": ..., "staticfiles": ...}`.
- **POST-only logout (5.0+)**: `LogoutView`/`logout_then_login` reject GET → logout links return 405 and sessions stay alive. Fix: a POST form with `{% csrf_token %}`.
- **first()/last() after order_by() (6.1)**: no pk ordering is added once ordering was cleared with `order_by()` → arbitrary row. Fix: explicit `order_by("pk")`.
- **Signed-cookie salt (6.1)**: `SIGNED_COOKIE_LEGACY_SALT_FALLBACK` now defaults to `False` → cookies from `set_signed_cookie()` on older versions fail `get_signed_cookie()`.
- **Database minimums**: 6.0 needs Python 3.12+; 6.1 needs PostgreSQL 15+, MySQL 8.4+, MariaDB 10.11+, SQLite 3.37+. Flag version bumps against deployed servers.
