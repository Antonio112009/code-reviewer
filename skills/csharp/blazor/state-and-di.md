---
name: Circuit state and DI scopes
description: Blazor state defects — singletons shared by every user on the server, scoped services and DbContexts living for the whole circuit, HttpContext used during interactive rendering, per-circuit memory growth and WebAssembly scoped services behaving as singletons.
priority: 66
tags: [CWE-488, CWE-200]
activation:
  content:
    - '\bAdd(?:Singleton|Scoped|Transient)\b|\bIDbContextFactory<|\bOwningComponentBase\b'
    - '\bIHttpContextAccessor\b|\bHttpContext\b|\bAuthenticationStateProvider\b|\bCircuitHandler\b'
    - '\bProtected(?:Session|Local)Storage\b|\bstatic\s+(?!readonly\b)[\w<>,?\[\]]+\s+_?\w+\s*[=;]'
  examples:
    - 'builder.Services.AddScoped<ICartService, CartService>();'
    - 'private readonly IDbContextFactory<AppDbContext> _dbFactory;'
    - 'public class ReportViewer : OwningComponentBase<IReportService>'
    - '[Inject] private IHttpContextAccessor HttpContextAccessor { get; set; } = default!;'
    - 'var user = HttpContext.User;'
    - 'var state = await AuthenticationStateProvider.GetAuthenticationStateAsync();'
    - 'public class CircuitTracker : CircuitHandler'
    - 'await ProtectedLocalStorage.SetAsync("theme", value);'
    - 'private static int _activeCircuits;'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/dependency-injection
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/components/httpcontext
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/blazor-ef-core
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management/server
---
- **Singletons are shared**: on the server, `AddSingleton` services and static fields are shared by every circuit → one user's cart, filters or identity appear for others. Fix: scoped (per-circuit) services for user state.
- **Circuit-long scopes**: server-side scoped services live as long as the SignalR circuit (possibly hours) — a scoped `DbContext` is reused across UI events → stale data, "second operation" errors, memory growth. Fix: `IDbContextFactory<T>` per operation or `OwningComponentBase`.
- **HttpContext in interactive components**: `IHttpContextAccessor.HttpContext`/a cascading `HttpContext` is null or belongs to the initial request during interactive rendering → wrong user, missing headers. Fix: `AuthenticationStateProvider`/`Task<AuthenticationState>`; HttpContext only in static SSR.
- **Circuit memory**: large per-user state (result sets, files, images) kept in components or scoped services × concurrent users, plus disconnected circuits retained for a period → server memory exhaustion. Fix: page data, keep state small, persist elsewhere.
- **WebAssembly scopes**: in the browser, scoped services behave like singletons for the app's lifetime → disposables never disposed, state survives across pages. Fix: explicit lifetime management.
- **Lost state**: in-memory circuit state vanishes on reconnect failure, refresh, or when load balancing without sticky sessions → lost form data and inconsistent UI. Fix: persist important state; sticky sessions or Azure SignalR Service.
