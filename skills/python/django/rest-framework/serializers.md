---
name: Serializers and input validation
description: DRF serializer defects — mass assignment, read_only_fields/extra_kwargs ignored for declared fields, raw request.data after validation, client-supplied owners, partial updates skipping cross-field checks, implicit unique-together requirements and the 3.18 list-error format.
priority: 70
tags: [CWE-915, CWE-20, A01:2025]
activation:
  content:
    - '\b(?:ModelSerializer|HyperlinkedModelSerializer|Serializer|ListSerializer)\b'
    - '\b(?:read_only_fields|extra_kwargs|validated_data|is_valid|partial\s*=\s*True|HiddenField|CurrentUserDefault|UniqueTogetherValidator)\b'
    - '\bfields\s*=\s*["'']__all__["'']|\bexclude\s*=\s*[\[(]'
    - '\bdef\s+(?:validate\w*|create|update|to_internal_value)\s*\('
    - '\bmany\s*=\s*True\b|\bLIST_SERIALIZER_ERRORS_AS_DICT\b'
  examples:
    - 'class OrderSerializer(serializers.ModelSerializer):'
    - 'read_only_fields = ["id", "created"]'
    - '        fields = "__all__"'
    - '    def validate_email(self, value):'
    - 'serializer = OrderSerializer(data=request.data, many=True)'
sources:
  - https://www.django-rest-framework.org/api-guide/serializers/
  - https://www.django-rest-framework.org/api-guide/validators/
  - https://www.django-rest-framework.org/api-guide/fields/
---
- **Mass assignment**: `fields = "__all__"` or `exclude` makes new model fields (`is_staff`, `owner`) writable and exposed. Fix: explicit `fields`.
- **Ignored read-only config**: `read_only_fields` and `extra_kwargs` do not apply to fields declared explicitly on the serializer (or a parent) → the field stays writable. Fix: `read_only=True` on the declaration.
- **Validation bypassed**: `Model.objects.create(**request.data)` or reading `request.data` after `is_valid()` uses raw input. Fix: `validated_data` only.
- **Owner from the client**: writable `user`/`owner`/`tenant` fields let clients act for others. Fix: `serializer.save(owner=request.user)` or `HiddenField(default=CurrentUserDefault())`.
- **Partial updates skip checks**: with `partial=True` (PATCH), `validate(self, attrs)` only sees submitted fields, so cross-field rules like `start < end` are skipped or `KeyError`. Fix: fall back to `self.instance` values.
- **Unique-together makes fields required**: `UniqueTogetherValidator` (also generated from `UniqueConstraint`) forces its fields to be required unless they have defaults → unexpected 400s.
- **Unchecked is_valid()**: calling `save()` after an unchecked `is_valid()` result raises `AssertionError` → 500 instead of 400. Fix: `is_valid(raise_exception=True)`.
- **List error format (3.18+)**: `many=True` errors became a dict keyed by index instead of a list with `{}` per valid item → clients indexing the list break. `LIST_SERIALIZER_ERRORS_AS_DICT = False` (3.18.1) is a stopgap.
