---
name: API Platform resources
description: API Platform 3–5 traps — default CRUD operations exposed, security evaluated before denormalization (owner reassignment), collection security that cannot filter rows, silently dropped protected properties, missing serialization groups, filters on sensitive fields and relation IRIs.
priority: 70
tags: [CWE-639, CWE-862, CWE-915, OWASP-A01]
activation:
  files: ["**/config/api_platform/**"]
  content:
    - '\bApiPlatform\\|#\[(?:ApiResource|ApiProperty|ApiFilter)\b'
    - '#\[(?:GetCollection|Get|Post|Put|Patch|Delete)\s*\(|\bsecurityPostDenormalize\b|\bprevious_object\b'
sources:
  - https://api-platform.com/docs/core/operations/
  - https://api-platform.com/docs/symfony/security/
  - https://api-platform.com/docs/core/serialization/
  - https://api-platform.com/docs/core/extensions/
---
- **Default operations**: `#[ApiResource]` without `operations` exposes GET and POST on the collection plus GET, PATCH and DELETE on items → unintended write and delete endpoints. Fix: declare operations explicitly.
- **security runs before denormalization**: `security: "object.owner == user"` on PATCH/PUT sees the stored object, so the owner can reassign `owner` to someone else. Fix: `securityPostDenormalize` comparing `object` and `previous_object` (a shallow clone).
- **Collection security**: `security` on `GetCollection` cannot remove rows → every row is listed. Fix: Doctrine query extensions or a state provider that filters by the current user.
- **Dropped properties**: failing property-level `securityPostDenormalize` silently discards those values while the request succeeds → clients assume the write happened; set `throw_on_access_denied`.
- **Serialization groups**: resources without `normalizationContext`/`denormalizationContext` groups read and write every property (password hashes, roles). Fix: explicit groups or DTO inputs and outputs.
- **Filters and relations**: `#[ApiFilter(SearchFilter::class)]` on secrets such as emails or tokens turns filtering into an oracle; writable relations accept any IRI (`"owner": "/api/users/2"`) → objects linked to other users. Fix: validate referenced objects.
