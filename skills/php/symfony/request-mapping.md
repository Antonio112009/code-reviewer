---
name: Request mapping and Serializer
description: MapRequestPayload/MapQueryString/MapUploadedFile and Serializer traps — payloads mapped onto entities, nested objects without Assert\Valid, null-tolerant constraints, empty bodies skipping validation, serializer leaks, ignored extra attributes, InputBag::get() on arrays and Request::get() removal.
priority: 68
tags: [CWE-915, CWE-20, CWE-200]
activation:
  content:
    - '#\[(?:MapRequestPayload|MapQueryString|MapQueryParameter|MapUploadedFile|Groups|Ignore|MaxDepth)\b'
    - '->(?:deserialize|denormalize|normalize|serialize)\s*\(|\bOBJECT_TO_POPULATE\b|\bALLOW_EXTRA_ATTRIBUTES\b'
    - '\$request->(?:query|request|attributes)->get\s*\(|\$request->get\s*\('
  examples:
    - 'public function create(#[MapRequestPayload] ProductInput $input): Response'
    - '$product = $serializer->deserialize($json, Product::class, ''json'', [OBJECT_TO_POPULATE => $entity]);'
    - '$ids = $request->query->get(''ids'');'
sources:
  - https://symfony.com/doc/current/controller.html#mapping-request-data-to-typed-objects
  - https://symfony.com/doc/current/serializer.html
  - https://symfony.com/doc/current/components/http_foundation.html
  - https://github.com/symfony/symfony/blob/8.1/UPGRADE-8.0.md
---
- **Payload onto entities**: `#[MapRequestPayload] Product $product` or `deserialize(…, [OBJECT_TO_POPULATE => $entity])` lets clients set any writable property (id, owner, roles, price) → mass assignment. Fix: input DTOs with explicit mapping or denormalization groups.
- **Nested validation**: nested DTOs and arrays of DTOs are not validated without `#[Assert\Valid]`, and most constraints (`Email`, `Length`, `Range`) accept `null` → add `NotNull`/`NotBlank`.
- **Empty input**: when the body or query string is empty and the argument is nullable or has a default, the resolver returns null/default without validation; `MapQueryString` failures answer 404, not 422.
- **Serializer leaks**: normalizing entities without `groups` exposes every getter (password hashes, tokens) and walks lazy relations (extra queries, cycles). Fix: explicit groups or response DTOs.
- **Ignored fields**: `ALLOW_EXTRA_ATTRIBUTES` is true by default → misspelled or unexpected fields are dropped silently and clients believe they were saved. Fix: `false` on write endpoints.
- **InputBag and Request::get()**: `$request->query->get('ids')` throws `BadRequestException` for `?ids[]=1` (use `all('ids')`); `Request::get()` searches attributes, query, then body (a query value overrides the POSTed one) and is removed in 8.0.
- **Uploaded files**: `#[MapUploadedFile]` without `File` constraints, or trusting `getClientOriginalName()`/`getClientMimeType()` and moving into `public/` → executable or spoofed uploads. Fix: constraints, `guessExtension()`, private storage.
