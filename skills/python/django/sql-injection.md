---
name: ORM injection and query-shape control
description: Django-specific SQL injection and data-exposure paths — user dicts expanded into QuerySet methods (2025–2026 CVE class), user-chosen lookups/order_by/values keys, and interpolated raw(), RawSQL() and extra().
priority: 74
tags: [CWE-89, CWE-639, A05:2025]
activation:
  content:
    - '\(\s*\*\*\s*(?:request|self\.request|data|params|query|filters|kwargs|serializer|form)\b'
    - '\b(?:filter|exclude|get|annotate|alias|aggregate|values|values_list|order_by|Q)\(\s*\*'
    - '\.order_by\([^)\n]{0,80}\b(?:request|GET|query_params|sort|order)\b'
    - '\b(?:raw|extra|RawSQL)\('
    - '\bFilteredRelation\('
sources:
  - https://docs.djangoproject.com/en/stable/topics/db/sql/
  - https://docs.djangoproject.com/en/stable/releases/security/
  - https://docs.djangoproject.com/en/stable/releases/5.2.8/
  - https://docs.djangoproject.com/en/stable/releases/6.0.2/
---
- **Dict expansion into QuerySet APIs**: `filter(**request.GET.dict())`, `Q(**data)`, `annotate(**user_dict)`/`alias()`/`aggregate()` let clients control keys; crafted `_connector` or alias keys were SQL injection (CVE-2025-57833, CVE-2025-64459, CVE-2026-1287; all fixed by 5.2.11 / 6.0.2). Fix: allowlist keys.
- **User-chosen lookups leak data**: even on patched versions, arbitrary keys allow `password__startswith=`, `user__is_staff=` or cross-relation filters → blind extraction of hidden fields. Fix: map allowed params to fixed lookups (django-filter with explicit fields).
- **order_by / values from input**: `order_by(request.GET["sort"])` sorts by any field or relation path (an oracle on hidden columns; aliases were injectable, CVE-2026-1312); `values(*user_fields)` returns any column. Fix: allowlist.
- **Interpolated raw SQL**: f-strings, `%` or `.format()` in `Model.objects.raw()`, `RawSQL()` or `extra(where=...)` → injection. Fix: pass `params`; `extra()` is a last resort.
- **Quoted placeholders**: `'%s'` inside quotes in `raw()`/`RawSQL()` defeats parameter binding. Fix: bare `%s`.
- **Identifiers from input**: table/column names cannot be parameters. Fix: allowlist, then `connection.ops.quote_name()`.
