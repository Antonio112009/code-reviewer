---
name: ILogger usage
description: Microsoft.Extensions.Logging defects — interpolated message templates, positional placeholder binding, exceptions logged without the exception argument, sensitive data in logs (incl. EF sensitive-data logging, HTTP logging), undisposed scopes and per-call LoggerFactory instances.
priority: 56
tags: [CWE-532, A09:2025]
activation:
  content:
    - '\b_?[Ll]ogger\.Log(?:Trace|Debug|Information|Warning|Error|Critical)?\('
    - '\[LoggerMessage\b|\bBeginScope\(|\bLoggerFactory\.Create\('
    - '\bEnableSensitiveDataLogging\(|\bAddHttpLogging\(|\bHttpLoggingFields\b'
sources:
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/overview
  - https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2254
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/high-performance-logging
---
- **Interpolated templates**: `LogInformation($"User {id} …")` or concatenation → no structured properties, formatting cost even when the level is off, template-cache churn (CA2254). Fix: constant templates with placeholders; `[LoggerMessage]` for hot paths.
- **Positional placeholders**: arguments bind to `{Placeholders}` by order, not by name → swapped values when argument order differs from the template. Fix: keep the same order.
- **Exception lost**: `LogError(ex.Message)`, `LogError("Failed {Error}", ex)` or `LogError("… " + ex)` → stack trace and inner exceptions missing from the exception field. Fix: `LogError(ex, "Failed to …")`.
- **Sensitive data**: logging whole DTOs, headers, tokens, connection strings or entities; `EnableSensitiveDataLogging()` (EF parameter values) or `AddHttpLogging` with request bodies/headers in production → PII and secrets in log stores. Fix: log ids, redact, development-only switches.
- **Scopes**: `BeginScope(...)` without disposing (`using`) → scope values attach to later, unrelated log entries in the same flow. Fix: `using var _ = logger.BeginScope(...)`.
- **Per-call factories**: `LoggerFactory.Create(b => b.AddConsole())` in constructors or methods → a new factory (console provider background thread, lost configuration) per call, never disposed. Fix: inject `ILogger<T>`.
