---
name: Component lifecycle and rendering
description: Blazor component defects — state changes from non-renderer threads, components writing to their own [Parameter]s, undisposed event/timer subscriptions, async void handlers, lists without @key, work after disposal and render loops from StateHasChanged in OnAfterRender.
priority: 62
activation:
  content:
    - '\bStateHasChanged\(|\bInvokeAsync\(|\bEventCallback\b'
    - '\[(?:Parameter|CascadingParameter)\]|\bOn(?:ParametersSet|AfterRender|Initialized)(?:Async)?\('
    - '@implements\s+I(?:Async)?Disposable|@key\b|@foreach\b|\basync\s+void\b'
  examples:
    - 'await InvokeAsync(() => { _count++; StateHasChanged(); });'
    - '[Parameter] public EventCallback<int> OnCountChanged { get; set; }'
    - 'protected override async Task OnParametersSetAsync()'
    - 'protected override void OnAfterRender(bool firstRender)'
    - '@implements IDisposable'
    - '@foreach (var item in Items)'
    - '<ItemRow @key="item.Id" Item="item" />'
    - 'private async void OnClick() => await SaveAsync();'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/components/synchronization-context
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/components/overwriting-parameters
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/components/lifecycle
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/components/element-component-model-relationships
---
- **Updates from other threads**: `StateHasChanged()` or state changes from timers, `Task.Run`, or events raised by singleton/scoped services → "The current thread is not associated with the Dispatcher" on the server, or races. Fix: `await InvokeAsync(() => { …; StateHasChanged(); })`.
- **Writing to parameters**: a child assigning its own `[Parameter]` (or binding an input to it) → overwritten when the parent re-renders; setter logic runs every render. Fix: copy to a field in `OnParametersSet`, notify the parent via `EventCallback`.
- **Leaked subscriptions**: `+=` on service events, `NavigationManager.LocationChanged` or timers without `@implements IDisposable` and `-=`/dispose → removed components stay alive and keep reacting (server memory grows per circuit). Fix: unsubscribe in `Dispose`.
- **async void handlers**: `async void` event handlers bypass Blazor's error handling and `ErrorBoundary`, and the UI doesn't re-render when they finish. Fix: `async Task` handlers.
- **Lists without `@key`**: rendering component lists that insert, remove or reorder items without `@key` → component state, focus and input values attach to the wrong item. Fix: `@key="item.Id"`.
- **Work after disposal**: after an `await` the component may already be disposed → `ObjectDisposedException` from JS/services, stale updates. Fix: a `CancellationTokenSource` cancelled in `Dispose`, checked after awaits.
- **Render loops**: calling `StateHasChanged()` in `OnAfterRenderAsync` without a `firstRender`/change guard → endless re-rendering. Fix: guard it.
