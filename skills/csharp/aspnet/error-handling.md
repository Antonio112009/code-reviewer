---
name: Exception handling and ProblemDetails
description: ASP.NET Core error-handling defects — exception details exposed outside development, IExceptionHandler returning true without a response (404) or with suppressed telemetry in .NET 10, handlers without the middleware, re-execution with the original HTTP method and swallowed failures.
priority: 64
tags: [CWE-209, A10:2025]
activation:
  content:
    - '\bUse(?:DeveloperExceptionPage|ExceptionHandler|StatusCodePages\w*)\('
    - '\bIExceptionHandler\b|\bAddExceptionHandler\b|\bTryHandleAsync\(|\bIExceptionHandler(?:Path)?Feature\b'
    - '\bAddProblemDetails\(|\bProblemDetails\b|\bEnableDetailedErrors\b|\bIncludeExceptionDetails\b'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling
  - https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/10/exception-handler-diagnostics-suppressed
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api
---
- **Details leaked**: `UseDeveloperExceptionPage()`, `EnableDetailedErrors` or custom handlers putting `exception.Message`/`ToString()` into `ProblemDetails.Detail` outside `IsDevelopment()` → stack traces, SQL and paths exposed. Fix: generic message plus trace id; details only in logs.
- **IExceptionHandler contract**: `TryHandleAsync` returning `true` without writing status/body yields a 404; handlers are singletons (scoped dependencies captured); .NET 10 stops logging/metering handled exceptions by default (`SuppressDiagnosticsCallback`). Fix: write the full response, log inside the handler.
- **Missing middleware**: `AddExceptionHandler<T>()` without `app.UseExceptionHandler()` → handlers never run; `UseExceptionHandler()` without a path, `ProblemDetails` service or fallback throws at startup. Fix: register both.
- **Re-execution method**: `UseExceptionHandler("/Error")` re-executes with the original HTTP method — an error endpoint restricted to `[HttpGet]` doesn't run for failed POSTs; middleware must tolerate running twice. Fix: no verb restriction on the error endpoint.
- **Swallowed failures**: catch-alls that return `Ok()`/200, or try to write an error after `Response.HasStarted` → clients see success or truncated bodies. Fix: rethrow or return 5xx; check `HasStarted`.
