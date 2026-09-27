---
name: Render modes and prerendering
description: Blazor Web App (.NET 8+) render-mode defects — components silently static without @rendermode, prerendering running initialization twice, persisted prerender state exposed in HTML, render-mode boundary rules and server-only code in Auto/WebAssembly components.
priority: 66
activation:
  versions: { framework.aspnet: ">=8" }
  content:
    - '@rendermode\b|\bRenderMode\.\w+|\bInteractive(?:Server|WebAssembly|Auto)(?:RenderMode)?\b'
    - '\bAddInteractive(?:Server|WebAssembly)(?:Components|RenderMode)\(|\bprerender:\s*false\b'
    - '\bPersistentComponentState\b|\[PersistentState\]|\bRendererInfo\b|\bOnInitialized(?:Async)?\('
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/components/prerender
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management/prerendered-state-persistence
---
- **Static by default**: in a Blazor Web App a component without `@rendermode` (and no interactive ancestor or global mode) renders as static SSR → `@onclick`, `@bind`, timers and JS interop silently do nothing. Fix: set an interactive mode on the page or `<Routes>`.
- **Prerender runs twice**: interactive components prerender by default, so `OnInitialized(Async)` runs on the server and again when interactive → duplicate API calls, double inserts, flicker. Fix: `[PersistentState]` (.NET 10)/`PersistentComponentState`, side-effect-free init, or `prerender: false`.
- **Persisted state is public**: prerendered state is serialized into the page → secrets or other users' data visible in the HTML source. Fix: persist only what the user may see.
- **Mode boundaries**: a child can't switch to a different interactive mode (Server inside WebAssembly); parameters from a static parent to an interactive child must be JSON-serializable, so `RenderFragment`/`ChildContent`/delegates fail. Fix: move the boundary, pass ids and load data in the child.
- **Code on the client**: `InteractiveAuto`/`InteractiveWebAssembly` components run in the browser from the `.Client` project → server-only services (`DbContext`, secrets, `IHttpContextAccessor`) are unavailable or leak into the download. Fix: call a web API; per-host service implementations.
- **Assuming interactivity**: JS interop or navigation during prerender/static SSR fails. Fix: check `RendererInfo.IsInteractive` (.NET 9+) or defer to `OnAfterRenderAsync`.
