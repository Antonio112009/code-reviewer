---
name: Model binding and over-posting
description: Mass assignment and binding surprises — entities bound from requests, [Bind]/[BindNever] ignored for JSON bodies, [Required] on value types, JsonPatchDocument applied to entities, culture differences between query and form values and SupportsGet binding.
priority: 70
tags: [CWE-915, CWE-20, A01:2025]
activation:
  content:
    - '\[(?:FromBody|FromForm|Bind|BindNever|BindRequired|BindProperty|Required)\b'
    - '\bTryUpdateModel(?:Async)?\(|\bJsonPatchDocument\b|\.ApplyTo\('
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/mvc/models/model-binding
  - https://learn.microsoft.com/en-us/aspnet/core/mvc/models/validation
  - https://learn.microsoft.com/en-us/aspnet/core/web-api/jsonpatch
---
- **Binding entities**: `[FromBody] User user`, `[BindProperty] public Order Order`, or `TryUpdateModelAsync(entity)` without an include list → clients set `IsAdmin`, `OwnerId`, `Price`, `Id`, `TenantId` (mass assignment). Fix: input DTOs/view models with explicit mapping.
- **Attributes skipped for JSON**: `[Bind]`, `[BindNever]`, `[BindRequired]` apply to form/route/query binding only; input formatters (`[FromBody]` JSON/XML) ignore them → "protected" properties still bound. Fix: DTOs, `[JsonIgnore]` for server-owned fields.
- **[Required] on value types**: non-nullable `int`, `bool`, `Guid`, `DateTime` always hold a value → `[Required]` never fails; a missing JSON field becomes `0`/`false`/`Guid.Empty`. Fix: nullable type plus `[Required]`, or `[JsonRequired]`/`required`.
- **JSON Patch on entities**: `JsonPatchDocument<Entity>.ApplyTo(entity)` lets clients add/replace any path (ids, roles, nested collections). Fix: apply to a DTO, validate, then map; restrict allowed paths.
- **Culture split**: route and query values bind with the invariant culture, form values with the current culture → `1.5`/`1,5` and dates differ between GET and POST. Fix: invariant client formatting or an explicit culture.
- **SupportsGet**: `[BindProperty(SupportsGet = true)]` binds page properties from query strings on GET → crafted links pre-set state or trigger side effects in `OnGet`. Fix: bind on POST only, no side effects in GET handlers.
