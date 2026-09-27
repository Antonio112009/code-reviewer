---
name: Admin
description: Django admin defects with a real cost — changelist N+1 queries, full-table FK dropdowns, expensive counts and searches, unscoped querysets for staff, mutating actions without permissions and user editing that grants superuser power.
priority: 60
tags: [CWE-269, CWE-400]
activation:
  files: ["**/admin.py", "**/admin/*.py"]
  content:
    - '\b(?:ModelAdmin|TabularInline|StackedInline|admin\.register|admin\.site\.register|admin\.action)\b'
    - '\b(?:list_display|list_select_related|search_fields|list_filter|list_editable|raw_id_fields|autocomplete_fields|show_full_result_count)\b'
sources:
  - https://docs.djangoproject.com/en/stable/ref/contrib/admin/
  - https://docs.djangoproject.com/en/stable/ref/contrib/admin/actions/#setting-permissions-for-actions
  - https://docs.djangoproject.com/en/stable/topics/auth/default/
---
- **Changelist N+1**: `list_display` entries that follow relations, without `list_select_related` or a `get_queryset()` using `select_related`/`prefetch_related` → one query per row (`list_select_related = True` is deprecated in 6.1).
- **Full-table dropdowns**: ForeignKey/M2M fields to large tables render every row in a `<select>` → slow or timed-out change pages. Fix: `raw_id_fields` or `autocomplete_fields` (with `search_fields` on the target admin).
- **Expensive counts and search**: the default `show_full_result_count = True` runs an unfiltered `COUNT(*)` per page; `search_fields` with `icontains` across relations scans tables. Fix: `show_full_result_count = False`, `^`/`=` prefixes, indexes.
- **Unscoped staff access**: multi-tenant admins without `get_queryset()` filtering and object-level `has_change_permission()` let any staff user see and edit every tenant's rows.
- **Actions without permissions**: `@admin.action` without `permissions=[...]` is offered to anyone who can open the changelist, including view-only staff → bulk updates or deletes. Fix: `permissions=["change"]` or a custom `has_<name>_permission`.
- **User editing escalates**: granting non-superusers change permission on users (or a custom UserAdmin exposing `is_superuser`, `groups`, `user_permissions`) lets them promote themselves. Fix: readonly fields or superuser-only checks.
- **list_editable (<6.0.4 / <5.2.13)**: forged POSTs could create objects through the changelist formset (CVE-2026-4292). Fix: upgrade before adding `list_editable`.
