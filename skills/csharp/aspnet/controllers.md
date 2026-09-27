---
name: MVC controllers and actions
description: Controller defects — ModelState never checked without [ApiController], public helper methods exposed as actions, null results turned into 204, state-changing GET or verb-less actions, single [FromBody] binding and entities returned directly from actions.
priority: 64
tags: [CWE-20, CWE-352, CWE-213]
activation:
  content:
    - '\bControllerBase\b|:\s*Controller\b|\bPageModel\b'
    - '\[(?:ApiController|NonAction|Http(?:Get|Post|Put|Patch|Delete)|Route|FromBody)\b'
    - '\bIActionResult\b|\bActionResult<|\bModelState\b'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/web-api/
  - https://learn.microsoft.com/en-us/aspnet/core/mvc/models/validation
  - https://learn.microsoft.com/en-us/aspnet/core/web-api/advanced/formatting
  - https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/actions
---
- **ModelState ignored**: controllers without `[ApiController]` never return automatic 400s — actions must check `ModelState.IsValid`; missing checks persist invalid data. Fix: `[ApiController]` (needs attribute routing) or explicit checks.
- **Public methods become actions**: every public non-`[NonAction]` method on a controller is routable (conventional routes map `/{controller}/{action}`) → helpers callable over HTTP. Fix: make them `private`/`[NonAction]` or move them out.
- **null → 204**: returning `null` from an action (`return await repo.FindAsync(id);`) produces `204 No Content`, not 404 → clients treat missing resources as success. Fix: `return item is null ? NotFound() : Ok(item);`.
- **Unsafe verbs**: state changes behind `[HttpGet]`, or actions with only `[Route]`/conventional routes (they accept every HTTP method) → CSRF through links/images, crawler and prefetch triggers, cached mutations. Fix: POST/PUT/DELETE with explicit verb attributes.
- **One body**: only one parameter can be read from the body — a second `[FromBody]` (or an inferred complex parameter) never gets data. Fix: a single request DTO.
- **Entities as responses**: returning EF entities or domain objects serializes every property (password hashes, internal flags, other users' navigations) and can trigger lazy-loading cycles. Fix: response DTOs.
