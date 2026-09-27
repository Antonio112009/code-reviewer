---
name: JDK HTTP clients
description: java.net.http.HttpClient and HttpURLConnection defects — no request/connect timeouts by default, a new client per request, unclosed streaming bodies, unchecked status codes and redirect policies.
priority: 58
tags: [CWE-400, CWE-772, CWE-252]
activation:
  content:
    - '\b(?:HttpClient|HttpRequest|HttpResponse|HttpURLConnection|HttpsURLConnection)\b'
    - '\.(?:openConnection|openStream)\('
    - '\bBodyHandlers\.'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.Builder.html#timeout(java.time.Duration)
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpResponse.BodyHandlers.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/URLConnection.html#setReadTimeout(int)
---
- **No request timeout**: an `HttpRequest` without `.timeout(...)` waits forever ("same as an infinite Duration"); an `HttpClient` without `connectTimeout` relies on OS limits → hung request threads. Fix: set both.
- **URLConnection defaults**: `HttpURLConnection`/`URL.openStream()` default connect and read timeouts are 0 (infinite). Fix: `setConnectTimeout`/`setReadTimeout` before connecting.
- **Client per request**: `HttpClient.newHttpClient()` inside a method → no connection reuse, extra threads and sockets per call. Fix: one shared client; close short-lived ones (`AutoCloseable` since JDK 21).
- **Unclosed bodies**: `BodyHandlers.ofInputStream()`/`ofLines()` results not closed leak connections; `ofString()`/`ofByteArray()` buffer untrusted responses fully. Fix: try-with-resources, stream with size limits.
- **Status not checked**: `send()` returns 4xx/5xx normally, without an exception → error pages parsed as data. Fix: check `statusCode()` first.
- **Redirect policy**: the default `Redirect.NEVER` returns 3xx as final; `Redirect.ALWAYS` also follows HTTPS→HTTP and hops to internal hosts (SSRF allow-list bypass). Fix: `NORMAL`, or validate every hop.
