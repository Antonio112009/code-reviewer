---
name: Dynamic code and reflection from input
description: Code-injection sinks in .NET — types/assemblies/members chosen by input via reflection, System.Linq.Dynamic.Core string expressions (CVE-2023-32571), DataTable expression strings, Roslyn scripting and runtime-compiled Razor templates.
priority: 76
tags: [CWE-94, CWE-470, CWE-917, A05:2025]
activation:
  content:
    - '\bType\.GetType\(|\bAssembly\.(?:Load|LoadFrom|LoadFile|UnsafeLoadFrom)\(|\bActivator\.CreateInstance\('
    - 'System\.Linq\.Dynamic|\bDynamicExpressionParser\b|\.(?:Where|OrderBy|Select)\(\s*\$?"'
    - '\bRowFilter\b|\.Compute\(|\bDataTable\b[^\n]{0,60}\.Select\(|\.Expression\s*='
    - '\bCSharpScript\b|\bCSharpCompilation\b|\bRazorLight\b|\bRazorEngine\b|\.(?:GetMethod|GetProperty|InvokeMember)\('
sources:
  - https://github.com/advisories/GHSA-w65q-jcmv-28gj
  - https://learn.microsoft.com/en-us/dotnet/api/system.data.dataview.rowfilter
  - https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/
---
- **Types from input**: `Type.GetType(input)`, `Assembly.Load*/LoadFrom(input)`, `Activator.CreateInstance(typeName, …)` → attacker-chosen types or assemblies run constructors/static initializers. Fix: map allowed keys to known types.
- **Dynamic LINQ strings**: `System.Linq.Dynamic.Core` `Where("…")`/`OrderBy(sortParam)` with user-controlled text → access to members beyond the intended fields; versions < 1.3.0 allow arbitrary method calls (CVE-2023-32571, RCE). Fix: ≥ 1.3.x, allowlisted field names, typed expressions.
- **DataTable expressions**: `DataView.RowFilter`, `DataTable.Select(filter)`, `DataTable.Compute(expr, …)`, `DataColumn.Expression` built from input → expression injection, data leaks, DoS. Fix: escape/allowlist or filter with LINQ.
- **Runtime compilation**: `CSharpScript.EvaluateAsync/RunAsync`, `CSharpCompilation` + `Assembly.Load`, or rendering user-supplied Razor templates (RazorLight, RazorEngine) → full code execution in-process; .NET Core has no sandbox. Fix: logic-less templates, out-of-process isolation.
- **Reflection by name**: `GetMethod(name).Invoke`, `GetProperty(input).SetValue`, `InvokeMember` with user-chosen member names → calling unintended methods or setting protected properties. Fix: allowlist member names.
