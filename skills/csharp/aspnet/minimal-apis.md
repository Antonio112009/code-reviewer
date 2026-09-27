---
name: Minimal APIs
description: Minimal API defects — no DataAnnotations validation before .NET 10 (and AddValidation's assembly scope), MVC binding attributes ignored by [FromForm] mapping, .NET 8 form/IFormFile antiforgery requirements, implicit binding sources, group authorization scope and discarded IResult values.
priority: 66
tags: [CWE-20, CWE-915, CWE-352]
activation:
  content:
    - '\.Map(?:Get|Post|Put|Patch|Delete|Methods|Group)\('
    - '\bRouteGroupBuilder\b|\bIEndpointRouteBuilder\b|\[AsParameters\]|\bAddEndpointFilter\b'
    - '\b(?:Typed)?Results\.\w+\(|\b(?:Disable|Add)Validation\(|\bDisableAntiforgery\('
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding
  - https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0
  - https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/8/antiforgery-checks
  - https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery
---
- **No validation before .NET 10**: in .NET 8/9 handlers don't run `[Required]`/`[Range]` on bound DTOs → invalid input processed. .NET 10 `AddValidation()` covers only types in the assembly that calls it. Fix: an explicit validation filter, or `AddValidation()` in the endpoints' assembly.
- **[FromForm] ignores MVC attributes**: complex form mapping doesn't honour `[BindNever]`/`[BindRequired]` → clients over-post properties. Fix: dedicated input DTOs.
- **Form antiforgery (.NET 8+)**: endpoints binding `IFormFile`/`[FromForm]` need antiforgery services and middleware (`UseAntiforgery()` after authentication/authorization) or throw at runtime; `.DisableAntiforgery()` on cookie-authenticated endpoints reopens CSRF. Fix: disable only for token/API-key endpoints.
- **Implicit binding sources**: complex types bind from the JSON body (only one body parameter; never for GET/DELETE/HEAD/OPTIONS); DI-registered types are injected instead of bound; invalid values for nullable query params give 400, not null. Fix: explicit `[FromQuery]`/`[FromBody]`/`[FromServices]`, `[AsParameters]`.
- **Group authorization scope**: `MapGroup(...).RequireAuthorization()` covers only endpoints mapped on that group — endpoints on `app` or sibling groups stay anonymous; `.AllowAnonymous()` on a group opens everything below. Fix: `FallbackPolicy` plus explicit opt-outs.
- **Discarded results**: `Results.NotFound()`/`TypedResults.BadRequest()` called without `return` → handler continues and returns 200. Fix: return every `IResult`.
