---
name: Views, viewsets and querysets
description: DRF view-layer defects — class-level querysets frozen at import, serializer-driven N+1 queries, ModelViewSet exposing unintended write/delete routes, Django exceptions surfacing as 500s and non-unique lookup fields.
priority: 64
tags: [CWE-639, CWE-400]
activation:
  content:
    - '\b(?:ModelViewSet|ReadOnlyModelViewSet|GenericViewSet|ViewSet|GenericAPIView|APIView|ListAPIView|RetrieveAPIView|ListCreateAPIView|RetrieveUpdateDestroyAPIView)\b'
    - '\b(?:get_queryset|get_object|perform_create|perform_update|perform_destroy|lookup_field|http_method_names)\b'
    - '^[ \t]*queryset\s*='
    - '\b(?:SerializerMethodField|StringRelatedField|source\s*=)'
sources:
  - https://www.django-rest-framework.org/api-guide/generic-views/
  - https://www.django-rest-framework.org/api-guide/viewsets/
  - https://www.django-rest-framework.org/api-guide/exceptions/
---
- **Queryset frozen at import**: a class attribute like `queryset = Order.objects.filter(created__gte=timezone.now() - delta)` computes `now()` once at import → a stale window forever. Fix: build it in `get_queryset()`; call `self.get_queryset()` rather than iterating `self.queryset`.
- **Serializer-driven N+1**: nested serializers, `source="a.b"`, `StringRelatedField` or a `SerializerMethodField` that queries per object → one query per row per field. Fix: `select_related`/`prefetch_related`/`annotate` in `get_queryset()`.
- **Over-exposed routes**: `ModelViewSet` also routes `update`, `partial_update` and `destroy`, often unintended for the resource. Fix: compose only the needed mixins or set `http_method_names`.
- **Django exceptions become 500s**: only `APIException`, `Http404` and `PermissionDenied` are converted; `django.core.exceptions.ValidationError` from `full_clean()` or an `IntegrityError` in `perform_create()` returns 500. Fix: validate in the serializer or raise `serializers.ValidationError`.
- **Non-unique lookup_field**: `lookup_field` on a non-unique column makes `get_object()` raise `MultipleObjectsReturned` (500), and guessable values enable enumeration.
