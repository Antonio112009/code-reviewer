---
name: OkHttp and Retrofit
description: HTTP client defects — network calls on the main thread, clients built per request, unclosed responses, verbose logging in release, auth tokens attached to every host, authenticators that never give up, silent retries of POSTs and Retrofit URL resolution surprises.
priority: 64
tags: [CWE-400, CWE-532, CWE-522]
activation:
  content:
    - '\bOkHttpClient(?:\.Builder)?\s*\('
    - '\bRetrofit\.Builder\s*\('
    - '\.execute\s*\(\s*\)'
    - '\.body\??\.(?:string|bytes|byteStream|charStream)\s*\('
    - '\bHttpLoggingInterceptor\b'
    - '\b(?:addInterceptor|addNetworkInterceptor|authenticator)\s*[({]'
    - '\bretryOnConnectionFailure\b'
    - '@(?:GET|POST|PUT|PATCH|DELETE|Url)\b'
sources:
  - https://github.com/square/okhttp/blob/master/okhttp/src/commonJvmAndroid/kotlin/okhttp3/OkHttpClient.kt
  - https://github.com/square/okhttp/blob/master/okhttp/src/commonJvmAndroid/kotlin/okhttp3/Authenticator.kt
  - https://github.com/square/okhttp/tree/master/okhttp-logging-interceptor
  - https://github.com/square/retrofit/blob/trunk/retrofit/src/main/java/retrofit2/Retrofit.java
---
- **Main-thread calls**: `execute()` or `body.string()` on the main thread → `NetworkOnMainThreadException`. Fix: `enqueue`, `suspend` service functions or `withContext(Dispatchers.IO)`.
- **Client per request**: `OkHttpClient()`/`Retrofit.Builder()` built per call → new connection and thread pools each time → leaked threads and sockets. Fix: one shared client; `newBuilder()` for variants.
- **Unclosed responses**: `Response`/`ResponseBody` from `execute()`/`onResponse` not closed on every path (errors, early returns) → leaked connections, pool exhaustion. Fix: `response.use { }`.
- **Logging in release**: `HttpLoggingInterceptor` at `HEADERS`/`BODY` in release → `Authorization`, cookies and bodies in logcat and crash logs. Fix: `NONE` in release, `redactHeader(…)`.
- **Token on every host**: an interceptor adding the bearer token to every request, including `@Url` absolute URLs and third-party hosts → credential leak. Fix: check `request.url.host` first.
- **Endless authenticator**: `Authenticator.authenticate` returning a retry even when the request already carried the refreshed token → infinite 401 loop. Fix: return `null` after a failed attempt; serialize refresh.
- **Silent retries**: `retryOnConnectionFailure` (default `true`) replays requests on stale pooled connections → a POST may run twice. Fix: idempotency keys or disable it for destructive calls.
- **Retrofit paths**: `@GET("/users")` with `baseUrl("https://api.example.com/v2/")` drops `/v2` (a leading `/` keeps only the host). Fix: relative endpoint paths; `baseUrl` must end in `/`.
