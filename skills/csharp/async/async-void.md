---
name: async void
description: async void methods and async lambdas converted to void delegates (List.ForEach, Parallel.ForEach, Thread/Timer callbacks, event handlers, actions) — unobservable completion and process-crashing exceptions.
priority: 64
tags: [CWE-248, A10:2025]
activation:
  content:
    - '\basync\s+void\b'
    - '\.ForEach\(\s*async\b|\bParallel\.(?:For|ForEach|Invoke)\([^\n]{0,200}\basync\b'
    - '\bnew\s+(?:Thread|Timer|System\.Threading\.Timer)\(\s*async\b|\+=\s*async\b'
  examples:
    - 'public async void OnClick(object sender, EventArgs e) => await SaveAsync();'
    - 'orders.ForEach(async order => await ProcessAsync(order));'
    - 'Parallel.ForEach(items, async item => await ProcessAsync(item));'
    - 'var timer = new Timer(async _ => await PollAsync(), null, 0, 1000);'
    - 'button.Click += async (s, e) => await SaveAsync();'
sources:
  - https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-scenarios
  - https://github.com/davidfowl/AspNetCoreDiagnosticScenarios/blob/master/AsyncGuidance.md
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices
---
- **`async void` methods**: anything except UI-style event handlers declared `async void` → callers can't await or observe it; an exception after the first `await` is rethrown on the thread pool/SynchronizationContext and crashes the process (ASP.NET Core, workers). Fix: `async Task`.
- **Async lambdas as `Action`**: `list.ForEach(async x => …)`, `Parallel.ForEach(items, async x => …)`, thread/timer callbacks → the lambda is `async void`: unawaited, the loop "finishes" early, exceptions crash. Fix: `foreach` + `await`, `Parallel.ForEachAsync` (.NET 6+), `Task.WhenAll`.
- **Legit handlers still crash**: `async void` event handlers (WinForms/WPF/MAUI, `Timer.Elapsed`) propagate unhandled exceptions to the process. Fix: try/catch the entire body and log.
- **Actions and handlers**: controller actions, Razor Page handlers or middleware written as `async void` → the request completes at the first `await`; later code touches a finished `HttpContext` (`ObjectDisposedException`, wrong responses). Fix: return `Task`/`Task<IActionResult>`.
- **Async init from constructors**: constructors calling `async void Init()` → object used before initialization finishes; failures crash later. Fix: static `CreateAsync` factory or `IHostedService.StartAsync`.
