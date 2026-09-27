---
name: Spring HTTP clients
description: RestTemplate, RestClient, WebClient and @HttpExchange defects — clients built without Boot's builders or timeouts, per-request clients, status-code handling, unreleased WebClient bodies, the 256 KB codec limit, redirect-based SSRF and concatenated URIs.
priority: 64
tags: [CWE-400, CWE-918]
activation:
  content:
    - '\b(?:RestTemplate|RestClient|WebClient|RestTemplateBuilder|ClientResponse|HttpServiceProxyFactory|ClientHttpRequestFactory)\b'
    - '@(?:HttpExchange|GetExchange|PostExchange|PutExchange|DeleteExchange)\b'
    - '\bspring\.(?:http\.clients?|codec)\.'
    - '^\s*(?:connect-timeout|read-timeout|max-in-memory-size|redirects):'
sources:
  - https://docs.spring.io/spring-boot/reference/io/rest-client.html
  - https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/client/SimpleClientHttpRequestFactory.html
  - https://docs.spring.io/spring-framework/reference/web/webflux-webclient/client-exchange.html
  - https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/codec/AbstractDataBufferDecoder.html
---
- **No timeouts**: `new RestTemplate()`, `RestClient.create()` or `WebClient.create()` bypass Boot's configured builders, and their defaults set no read/response timeout → one slow dependency hangs request threads. Fix: inject `RestClient.Builder`/`RestTemplateBuilder`/`WebClient.Builder`; set connect/read timeouts.
- **Client per call**: building a client (and its connection pool) inside request handling → socket churn, no keep-alive reuse. Fix: build once and share.
- **Status handling**: `RestTemplate` and `retrieve()` throw on 4xx/5xx — broad `catch (RestClientException)` turns outages into "not found"; custom error handlers or `exchange` code that ignore the status treat errors as data. Fix: handle specific statuses.
- **Unreleased WebClient bodies**: with `exchangeToMono`/`exchangeToFlux` the body must be consumed inside the callback; leaking the `ClientResponse` out leaks connections and buffers. Fix: `retrieve()` or decode in the callback.
- **256 KB codec limit**: WebClient/WebFlux decoders buffer at most 256 KB by default → `DataBufferLimitException` on larger payloads; raising it globally invites OOM. Fix: stream the body or raise it per client.
- **Redirect SSRF**: Boot-configured clients follow redirects by default → a validated external URL can redirect to internal hosts or metadata endpoints. Fix: don't follow redirects for user URLs; Boot 4.1 `InetAddressFilter`.
- **Concatenated URIs**: `base + "/users/" + id + "?q=" + q` → path/query injection and encoding bugs. Fix: URI templates (`"/users/{id}"`) or `UriBuilder`.
