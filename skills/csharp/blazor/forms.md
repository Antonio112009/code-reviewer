---
name: Blazor forms and validation
description: EditForm defects — nested objects not validated before .NET 10, OnSubmit skipping validation, WebAssembly-only validation, static SSR form binding/antiforgery requirements and over-posting via [SupplyParameterFromForm], and double submissions.
priority: 62
tags: [CWE-20, CWE-915]
activation:
  content:
    - '<EditForm\b|\bEditContext\b|\b(?:ObjectGraph)?DataAnnotationsValidator\b|\bValidationMessageStore\b'
    - '\bOn(?:Valid|Invalid)?Submit\b|\[SupplyParameterFromForm\b|\bFormName\b|\bAddValidation\('
  examples:
    - '<EditForm Model="_model" OnValidSubmit="HandleValidSubmit">'
    - 'private EditContext _editContext = new(_model);'
    - '<DataAnnotationsValidator />'
    - 'private readonly ValidationMessageStore _messages;'
    - '<EditForm Model="_model" FormName="checkout" OnSubmit="HandleSubmit">'
    - '[SupplyParameterFromForm] public OrderModel? Model { get; set; }'
    - 'editContext.AddValidation(dataAnnotationsProcessor);'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/validation
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/
  - https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery
---
- **Nested objects (≤ .NET 9)**: `DataAnnotationsValidator` validates only top-level properties — nested complex properties and collection items are never checked. Fix: .NET 10 `AddValidation()` with generated metadata, or `ObjectGraphDataAnnotationsValidator` + `[ValidateComplexType]` (experimental package) on older versions.
- **OnSubmit skips validation**: handling `OnSubmit` instead of `OnValidSubmit` runs no validation unless you call `editContext.Validate()` → invalid models saved. Fix: `OnValidSubmit`, or validate explicitly.
- **Client-only validation**: in WebAssembly the form is validated in the browser only → the API must validate (and authorize) every posted DTO again.
- **Static SSR forms (.NET 8+)**: forms rendered with static SSR need `FormName`, a `[SupplyParameterFromForm]` model and antiforgery (`UseAntiforgery()` after authentication/authorization) or posts are ignored/rejected; `[SupplyParameterFromForm]` binds every posted field → over-posting entity properties. Fix: dedicated form models.
- **Double submits**: async `OnValidSubmit` without an in-flight guard or disabled button → repeated clicks run the handler concurrently (duplicate orders, concurrent DbContext use). Fix: guard flag, disable while saving.
