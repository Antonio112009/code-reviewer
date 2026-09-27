---
name: Symfony forms
description: Form handling traps — invalid data already written into entities, isSubmitted() without isValid(), unscoped EntityType choices, unmapped fields without constraints, disabled CSRF, collections deleting rows, and the UrlType default_protocol change in 8.0.
priority: 66
tags: [CWE-20, CWE-639, CWE-352]
activation:
  content:
    - '->(?:createForm|createFormBuilder|handleRequest|isSubmitted|isValid)\s*\(|\bextends\s+AbstractType\b'
    - '\b(?:EntityType|CollectionType|UrlType)::class\b|[''"](?:mapped|csrf_protection|allow_extra_fields|query_builder|by_reference|allow_delete)[''"]\s*=>'
sources:
  - https://symfony.com/doc/current/forms.html
  - https://symfony.com/doc/current/reference/forms/types/entity.html
  - https://symfony.com/doc/current/reference/forms/types/collection.html
  - https://github.com/symfony/symfony/blob/8.1/UPGRADE-8.0.md
---
- **Invalid data already applied**: `handleRequest()` writes submitted values into the bound entity before validation → when `isValid()` is false but any later `flush()` runs (listener, other service), the invalid data is persisted. Fix: bind DTOs, or refresh/detach on failure.
- **isSubmitted without isValid**: `if ($form->isSubmitted())` alone saves unvalidated data. Fix: `isSubmitted() && isValid()`.
- **Unscoped EntityType**: choices whose `query_builder` is not limited to the current user or tenant accept any existing id → linking to other tenants' objects. Fix: scope the query builder.
- **Unmapped fields**: `'mapped' => false` fields are not covered by entity constraints → their values reach code unvalidated. Fix: add `constraints` on the field.
- **CSRF disabled**: `csrf_protection: false` on forms used with session authentication → cross-site submissions succeed.
- **Collections delete rows**: `CollectionType` with `allow_delete` and `by_reference => false` plus `orphanRemoval` → items missing from a (partial or tampered) submission are deleted.
- **UrlType in 8.0**: `default_protocol` now defaults to `null`, so `example.com` is stored without a scheme → rendered as a relative link. Fix: set `'default_protocol' => 'https'` or validate URLs.
