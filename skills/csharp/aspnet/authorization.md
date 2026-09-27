---
name: Authorization policies and attributes
description: ASP.NET Core authorization defects — no fallback policy so new endpoints are public, [AllowAnonymous] overriding everything below, [Authorize] ignored on Razor Page handlers, OR vs AND role semantics, lenient handlers and route ids without resource-based checks.
priority: 74
tags: [CWE-862, CWE-863, CWE-285, A01:2025]
activation:
  content:
    - '\[(?:Authorize|AllowAnonymous)\b|\bRequireAuthorization\(|\bAllowAnonymous\('
    - '\b(?:FallbackPolicy|DefaultPolicy|SetFallbackPolicy|AddAuthorization(?:Builder)?|AddPolicy)\b'
    - '\bIAuthorizationService\b|\bAuthorizationHandler<|\bIAuthorizationRequirement\b|\bIsInRole\('
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies
  - https://learn.microsoft.com/en-us/aspnet/core/razor-pages/security/authorization/simple
  - https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resourcebased
  - https://learn.microsoft.com/en-us/aspnet/core/security/authorization/roles
---
- **No fallback policy**: `FallbackPolicy` is null by default → any controller, page or endpoint without `[Authorize]` is public, including newly added ones. Fix: `SetFallbackPolicy(RequireAuthenticatedUser())` and explicit `[AllowAnonymous]`.
- **AllowAnonymous wins**: `[AllowAnonymous]` on a controller, base class, page or group (`.AllowAnonymous()`) bypasses every `[Authorize]`/policy below it. Fix: apply it at the narrowest scope only.
- **Razor Pages handlers**: `[Authorize]` on `OnPost…`/`OnGet…` handler methods isn't supported (filters apply to the PageModel class) → the handler stays reachable. Fix: separate pages, or `IAuthorizationService.AuthorizeAsync` inside the handler.
- **Role semantics**: `[Authorize(Roles = "Admin,Manager")]` means either role, while two stacked `[Authorize(Roles = …)]` attributes require both → misread permissions. Fix: named policies that state the rule.
- **Lenient handlers**: several handlers for one requirement are OR'ed — one calling `context.Succeed(requirement)` grants access unless another calls `context.Fail()`; handlers succeeding for requirements they don't own open other policies. Fix: explicit `Fail`, narrow handler types.
- **Policies don't see resources**: `[Authorize(Policy = "Owner")]` runs before the action loads the entity → ids from the route are never checked against the user. Fix: resource-based `IAuthorizationService.AuthorizeAsync(User, entity, policy)` after loading.
