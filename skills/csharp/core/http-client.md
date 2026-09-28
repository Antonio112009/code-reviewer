---
name: HttpClient usage
description: HttpClient defects — per-request clients and DNS staleness, typed clients captured in singletons, the .NET 9 SocketsHttpHandler cast break, BaseAddress path joining, unchecked status and full buffering, timeouts, shared mutable headers and pooled cookies.
priority: 60
tags: [CWE-400, CWE-918]
activation:
  content:
    - '\bHttpClient\b|\bIHttpClientFactory\b|\bAddHttpClient\b'
    - '\bHttp(?:Request|Response)Message\b|\bBaseAddress\b|\bDefaultRequestHeaders\b'
    - '\b(?:SocketsHttpHandler|HttpClientHandler|ConfigurePrimaryHttpMessageHandler)\b'
  examples:
    - 'var client = new HttpClient();'
    - 'client.BaseAddress = new Uri("https://api.example.com/v1/");'
    - 'services.AddHttpClient<OrdersClient>().ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler());'
sources:
  - https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines
  - https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/networking/9.0/default-handler
  - https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclient.baseaddress
---
- **Client per request**: `new HttpClient()` per call → socket/port exhaustion under load; a static client without `SocketsHttpHandler.PooledConnectionLifetime` misses DNS changes. Fix: `IHttpClientFactory` or one shared client with `PooledConnectionLifetime`.
- **Captured factory clients**: typed/named clients held by singletons or statics keep one handler forever; re-registering a typed client with `AddTransient/AddScoped` overwrites its `AddHttpClient<T>` setup. Fix: inject into transient/scoped consumers.
- **.NET 9 handler cast**: `ConfigurePrimaryHttpMessageHandler((h, _) => ((HttpClientHandler)h)…)` throws `InvalidCastException` on .NET 9+ (default is `SocketsHttpHandler`). Fix: create the handler explicitly.
- **BaseAddress joining**: no trailing `/` drops the last base segment (`…/v1` + `users` → `/users`); a leading `/` drops the base path; absolute or `//host` input ignores `BaseAddress` → wrong host or SSRF. Fix: base ends with `/`, reject absolute input.
- **Status and buffering**: no `EnsureSuccessStatusCode()` → error bodies parsed as data; default completion buffers the whole body (up to 2 GB) → OOM. Fix: check status, `ResponseHeadersRead` + stream, dispose the response.
- **Timeouts**: default 100 s `Timeout` surfaces as `TaskCanceledException`; no per-call token → requests outlive callers. Fix: pass `CancellationToken`, set timeouts deliberately.
- **Shared mutable state**: changing `DefaultRequestHeaders`/`BaseAddress` on a shared client → races, one user's `Authorization` sent for another; pooled handlers share cookies. Fix: per-request headers, `UseCookies = false`.
