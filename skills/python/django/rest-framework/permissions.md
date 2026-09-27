---
name: Permissions and object access
description: DRF authorization gaps — AllowAny by default, per-view permission_classes replacing defaults, object permissions that never run for list/create/custom views, OR-composed permissions granting every object, read-open DjangoModelPermissions and LoginRequiredMiddleware exemption.
priority: 74
tags: [CWE-285, CWE-639, CWE-862, A01:2025]
activation:
  content:
    - '\b(?:permission_classes|get_permissions|has_permission|has_object_permission|check_object_permissions|DEFAULT_PERMISSION_CLASSES)\b'
    - '\b(?:BasePermission|IsAuthenticated|IsAdminUser|AllowAny|IsAuthenticatedOrReadOnly|DjangoModelPermissions|DjangoObjectPermissions)\b'
    - '@action\(|@api_view\(|\bperform_create\b'
sources:
  - https://www.django-rest-framework.org/api-guide/permissions/
  - https://github.com/encode/django-rest-framework/blob/main/rest_framework/permissions.py
  - https://github.com/encode/django-rest-framework/blob/main/rest_framework/views.py
---
- **Open by default**: without `DEFAULT_PERMISSION_CLASSES`, DRF uses `AllowAny`; `permission_classes = []` or `@api_view` without `@permission_classes` publishes the view.
- **Override replaces defaults**: `permission_classes = [IsOwner]` drops the global `IsAuthenticated`; an `@action(permission_classes=...)` likewise replaces the viewset's.
- **Object permissions only in get_object()**: `has_object_permission()` never runs for `list`, `create`, custom `@action`s or `APIView`s that fetch objects themselves. Fix: scope `get_queryset()`, call `self.check_object_permissions(request, obj)`.
- **Create not covered**: object checks do not apply on create, so a client can attach objects to another user's parent. Fix: validate ownership in the serializer or `perform_create()`.
- **OR composition leaks objects**: `IsAuthenticated | IsOwner` passes object checks via `IsAuthenticated`, whose `has_object_permission()` returns `True` by default. Fix: `&`, or implement both methods.
- **DjangoModelPermissions reads**: its `perms_map` has no permissions for `GET`/`HEAD`/`OPTIONS` → any authenticated user can list and read. Fix: subclass `perms_map` to require `view`.
- **LoginRequiredMiddleware bypass**: DRF 3.16+ marks every API view `login_required = False`, so the middleware protects none of them. Fix: set `DEFAULT_PERMISSION_CLASSES`.
- **Action-based gaps**: `get_permissions()` branching on `self.action` without a restrictive default leaves new or renamed actions open.
