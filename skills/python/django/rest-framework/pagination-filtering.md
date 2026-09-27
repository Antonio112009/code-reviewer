---
name: Pagination, ordering and filtering
description: DRF list-endpoint defects — no pagination by default, client-controlled page sizes without caps, OrderingFilter and django-filter exposing sensitive fields, regex search DoS and unstable cursor ordering.
priority: 64
tags: [CWE-400, CWE-200]
activation:
  content:
    - '\b(?:pagination_class|DEFAULT_PAGINATION_CLASS|PAGE_SIZE|page_size_query_param|max_page_size|max_limit|default_limit)\b'
    - '\b(?:PageNumberPagination|LimitOffsetPagination|CursorPagination)\b'
    - '\b(?:filter_backends|DEFAULT_FILTER_BACKENDS|ordering_fields|search_fields|filterset_fields|filterset_class|OrderingFilter|SearchFilter|DjangoFilterBackend)\b'
sources:
  - https://www.django-rest-framework.org/api-guide/pagination/
  - https://www.django-rest-framework.org/api-guide/filtering/
  - https://django-filter.readthedocs.io/en/stable/ref/filterset.html
---
- **Unpaginated lists**: `DEFAULT_PAGINATION_CLASS` and `PAGE_SIZE` are both `None` by default, and setting only one leaves lists unpaginated → full-table responses as data grows. Fix: set both, or `pagination_class` per view.
- **Uncapped page size**: `page_size_query_param` without `max_page_size`, or `LimitOffsetPagination` without `max_limit` (default `None`) → `?page_size=1000000` or `?limit=1000000` loads everything.
- **Ordering on sensitive fields**: `OrderingFilter` without `ordering_fields` allows any readable serializer field, and `ordering_fields = "__all__"` allows any model field (e.g. password hashes) → sorting oracle. Fix: explicit `ordering_fields`.
- **Filtering on sensitive fields**: django-filter `filterset_fields = "__all__"` or lookups on secrets/relations (`user__password`, `token__startswith`) enable blind extraction. Fix: explicit fields and lookups.
- **Regex search DoS**: `search_fields` entries prefixed with `$` (`iregex`) run client-supplied regular expressions in the database. Fix: avoid `$` for untrusted clients.
- **Unstable cursor ordering**: `CursorPagination` ordering on non-unique or float fields skips or repeats rows; the default `-created` needs that field to exist. Fix: end with a unique, indexed field.
