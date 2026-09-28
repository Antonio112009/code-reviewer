---
name: Model fields and validation
description: Django model and field semantics that corrupt data — validation not run by save(), nullable strings, JSONField None vs JSON null, destructive on_delete, Meta.ordering inside DISTINCT, naive datetimes and time-zone dependent date lookups.
priority: 62
tags: [CWE-20, CWE-1284]
activation:
  content:
    - '\bmodels\.\w+Field\('
    - '\.distinct\(|^[ \t]*ordering\s*='
    - '\bon_delete\s*='
    - '\b(?:full_clean|clean_fields|validate_constraints|JSONNull)\b'
    - '\bdatetime\.(?:now|utcnow|today)\(\)|\bdate\.today\(\)'
    - '__(?:date|day|week_day|month|year|hour)\b|\bTrunc(?:Date|Day|Hour|Month|Week)?\('
  examples:
    - 'name = models.CharField(max_length=255)'
    - '        ordering = ["-created"]'
    - 'user = models.ForeignKey(User, on_delete=models.CASCADE)'
    - 'obj.full_clean()'
    - 'created = datetime.now()'
    - 'Order.objects.filter(created__date=today)'
sources:
  - https://docs.djangoproject.com/en/stable/ref/models/instances/#validating-objects
  - https://docs.djangoproject.com/en/stable/ref/models/fields/
  - https://docs.djangoproject.com/en/stable/topics/db/queries/#storing-and-querying-for-none
  - https://docs.djangoproject.com/en/stable/topics/i18n/timezones/
---
- **Validation skipped by save()**: `choices`, `validators`, `blank` and email/URL formats are enforced only by forms or `full_clean()`; `save()` from APIs, tasks or scripts stores invalid values. Fix: `full_clean()` or DB constraints.
- **Nullable strings**: `CharField(null=True)` has two empty values (`NULL`, `""`) → `filter(name="")` misses rows. Fix: no `null` unless unique.
- **JSONField None**: `create(data=None)` stores SQL `NULL`, but `filter(data=None)` matches JSON `null` (deprecated in 6.1) → rows silently missed. Fix: `data__isnull=True`, or `JSONNull()` on 6.1+.
- **Destructive on_delete**: `CASCADE` from orders, payments or audit rows to users erases history on delete. Fix: `PROTECT`/`RESTRICT`, soft delete.
- **Ordering leaks into DISTINCT**: `Meta.ordering` or `order_by()` on related fields adds those columns to `SELECT DISTINCT` (also with `values()`) → duplicates survive `distinct()`. Fix: clear with `order_by()` or order by selected fields.
- **Naive datetimes**: with `USE_TZ = True`, `datetime.now()` or `datetime(...)` without `tzinfo` are interpreted in `TIME_ZONE` (with a warning) and `date.today()` uses the server's zone → hours- or day-off values. Fix: `timezone.now()`, `timezone.localdate()`.
- **Time-zone dependent lookups**: `__date`, `__hour` and `Trunc*` use the current time zone, so requests (activated zone) and tasks (default zone) bucket rows differently. Fix: pass `tzinfo`.
