---
name: HttpClient and interceptors
description: Angular HttpClient interceptor defects — class interceptors silently ignored, credentials sent to third-party hosts, refresh loops, swallowed errors, unsafe retries, mutated bodies and v22 upload progress.
priority: 64
activation:
  content:
    - "\\bHttpInterceptor(?:Fn)?\\b"
    - "\\bwithInterceptors(?:FromDi)?\\s*\\("
    - "\\bHTTP_INTERCEPTORS\\b"
    - "\\bprovideHttpClient\\s*\\("
    - "\\bHttpContextToken\\b"
    - "\\breq\\.clone\\s*\\("
  examples:
    - 'export const authInterceptor: HttpInterceptorFn = (req, next) => next(req);'
    - 'provideHttpClient(withInterceptors([authInterceptor]));'
    - '{ provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }'
    - 'provideHttpClient(withInterceptorsFromDi());'
    - 'export const SKIP_AUTH = new HttpContextToken(() => false);'
    - 'return next(req.clone({ setHeaders: { Authorization: token } }));'
sources:
  - https://angular.dev/guide/http/interceptors
  - https://angular.dev/guide/http/setup
  - https://github.com/angular/angular/blob/main/CHANGELOG.md
---
- **Ignored class interceptors**: `HTTP_INTERCEPTORS` class interceptors with `provideHttpClient()` but no `withInterceptorsFromDi()` → never run (auth headers and error handling silently missing). Fix: add `withInterceptorsFromDi()` or convert to `HttpInterceptorFn` + `withInterceptors`.
- **Token to every host**: adding `Authorization`, API keys or `withCredentials: true` to all requests → credentials sent to CDNs, analytics or third-party APIs. Fix: attach only when the URL matches your API origin.
- **Refresh loops**: 401 handling that also retries the refresh endpoint, or starts one refresh per failed request → infinite loops, parallel refresh storms. Fix: bypass auth logic for the refresh call; share one in-flight refresh.
- **Swallowed errors**: `catchError(() => EMPTY)` or `of(null)` in an interceptor → callers complete without a value (`firstValueFrom` throws `EmptyError`) or treat `null` as success. Fix: rethrow after handling.
- **Unsafe retry**: `retry()` for every method → duplicated POST/PATCH side effects. Fix: retry idempotent methods only, with backoff.
- **Body mutation**: editing `req.body` objects in place instead of `req.clone({ body })` → the mutation repeats on retries and leaks into other interceptors. Fix: clone with a new body.
- **Upload progress (v22)**: HttpClient now uses fetch by default, which cannot report upload progress → progress UI stuck. Fix: `provideHttpClient(withXhr())` where upload progress matters.
