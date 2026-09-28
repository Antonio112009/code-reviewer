---
name: JavaScript interop
description: Blazor JS interop defects — interop calls during prerendering, undisposed IJSObjectReference/DotNetObjectReference and JSDisconnectedException on disposal, [JSInvokable] methods as unauthenticated entry points, oversized/untrusted payloads, eval-style calls and sync interop outside WebAssembly.
priority: 64
tags: [CWE-79, CWE-20, CWE-401]
activation:
  content:
    - '\bIJS(?:Runtime|ObjectReference|InProcessRuntime|InProcessObjectReference|StreamReference)\b|\bJS\.Invoke\w*\('
    - '\[JSInvokable\b|\bDotNetObjectReference\b|\bJSDisconnectedException\b|\bDotNetStreamReference\b'
    - '\bInvoke(?:Void)?Async\s*(?:<[^>\n]{1,60}>)?\(\s*"'
  examples:
    - 'public MyComponent(IJSRuntime js) { _js = js; }'
    - 'IJSObjectReference module = await _js.InvokeAsync<IJSObjectReference>("import", "./chart.js");'
    - 'await JS.InvokeVoidAsync("app.focus", elementRef);'
    - '[JSInvokable] public static Task<int> GetCount() => Task.FromResult(_count);'
    - 'var dotNetRef = DotNetObjectReference.Create(this);'
    - 'catch (JSDisconnectedException) { }'
    - 'return new DotNetStreamReference(stream);'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/javascript-interoperability/
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/javascript-interoperability/call-dotnet-from-javascript
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/javascript-interoperability/call-javascript-from-dotnet
---
- **Interop during prerender**: `IJSRuntime.InvokeAsync` in `OnInitialized(Async)`/`OnParametersSet` fails while prerendering (no browser yet). Fix: call from `OnAfterRenderAsync(firstRender)`.
- **Leaked references**: `IJSObjectReference` modules and `DotNetObjectReference.Create(this)` never disposed → JS and .NET objects pinned for the circuit/app lifetime. Disposing after the circuit is gone throws `JSDisconnectedException`. Fix: dispose in `DisposeAsync`, catching `JSDisconnectedException`.
- **[JSInvokable] is a public API**: any script in the page (or a modified client) can call `[JSInvokable]` methods with arbitrary arguments; on the server they run with the circuit's identity → treat as untrusted input, authorize and validate each call.
- **Payload size and trust**: JS→.NET calls on the server go over SignalR (`MaximumReceiveMessageSize` 32 KB by default) — raising it invites DoS; values returned by JS are attacker-controlled. Fix: `IJSStreamReference`/`DotNetStreamReference` for large data, validate results.
- **Script injection**: `InvokeVoidAsync("eval", code)` or building script text from user input → XSS in the app origin. Fix: call named module functions with arguments.
- **Sync interop**: `IJSInProcessRuntime.Invoke` only works in WebAssembly → shared components throw under Server/Auto. Fix: async interop in render-mode-agnostic components.
