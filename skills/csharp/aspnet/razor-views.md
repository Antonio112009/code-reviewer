---
name: Razor views and pages output
description: XSS and data exposure in MVC views and Razor Pages — Html.Raw/HtmlString with untrusted data, JSON embedded in script blocks with relaxed encoders, URL/JS/event-handler contexts where HTML encoding isn't enough and whole models serialized into pages.
priority: 72
tags: [CWE-79, CWE-116, CWE-200, A05:2025]
activation:
  content:
    - '\bHtml\.Raw\(|\bHtmlString\b|\bIHtmlContent\b'
    - '\bUnsafeRelaxedJsonEscaping\b|\bJavaScriptEncoder\b|@Json\.Serialize\(|\bJsonConvert\.SerializeObject\('
    - '<script\b|\b(?:href|src|action|formaction)="@|\bon[a-z]+="@'
  examples:
    - '@Html.Raw(Model.Description)'
    - 'var json = JsonConvert.SerializeObject(model);'
    - '<a href="@Model.ProfileUrl">Profile</a>'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/security/cross-site-scripting
  - https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/character-encoding
  - https://learn.microsoft.com/en-us/aspnet/core/mvc/views/razor
---
- **Raw HTML**: `@Html.Raw(value)`, `new HtmlString(value)` or `IHtmlContent` built by concatenation with user or database content → stored/reflected XSS (plain `@value` is encoded). Fix: encode, or sanitize with an allowlist HTML sanitizer.
- **JSON in `<script>`**: `@Html.Raw(JsonSerializer.Serialize(model))` is safe only with the default encoder; `JavaScriptEncoder.UnsafeRelaxedJsonEscaping` or `JsonConvert.SerializeObject` (doesn't escape `<`) lets `</script>` break out → XSS. Fix: default System.Text.Json encoder, or pass data via `data-*` attributes.
- **Wrong context**: user values in `href`/`src`/`action` (`javascript:` URLs), inline event handlers (`onclick="@value"`) or inside `<script>` string literals — HTML encoding doesn't neutralize them. Fix: validate URL schemes; `JavaScriptEncoder.Default` for JS contexts; no inline handlers.
- **Model dumps**: serializing whole entities/view models into the page (`@Json.Serialize(Model.User)`, hidden fields) → hashes, internal flags and other users' data in page source. Fix: purpose-built view models.
