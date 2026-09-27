---
name: Symfony HttpClient
description: HttpClient traps — lazy responses throwing on 3xx-5xx at read or destruct time, network errors surfacing outside try/catch, idle timeout vs max_duration, redirects and private networks for user URLs, disabled TLS verification.
priority: 62
tags: [CWE-755, CWE-400, CWE-918, CWE-295]
activation:
  content:
    - '\bHttpClientInterface\b|\bHttpClient::create\s*\(|\b(?:NoPrivateNetwork|Retryable|Scoping)HttpClient\b'
    - '->request\s*\(\s*[''"](?:GET|POST|PUT|PATCH|DELETE|HEAD)[''"]'
    - '[''"](?:max_redirects|max_duration|verify_peer|verify_host)[''"]\s*=>'
sources:
  - https://symfony.com/doc/current/http_client.html#handling-exceptions
  - https://symfony.com/doc/current/http_client.html#dealing-with-network-timeouts
  - https://symfony.com/doc/current/http_client.html#redirects
---
- **Lazy status errors**: 3xx–5xx throw only when `getHeaders()`, `getContent()` or `toArray()` run, or when the response is destructed → a fire-and-forget `$client->request('POST', …)` throws at an unexpected line; calling `getStatusCode()` disables that fallback, so check the code yourself.
- **Errors outside try/catch**: transport errors (DNS, reset, timeout) surface when the response is read, not at `request()` → a try/catch around `request()` alone misses them.
- **Timeouts**: `timeout` is the idle time and defaults to `default_socket_timeout` (60 s); a slowly streaming response can run indefinitely. Fix: set `timeout` and `max_duration`.
- **User URLs**: redirects are followed (up to 20 by default) and private addresses are reachable → SSRF to internal services and cloud metadata. Fix: wrap the client in `NoPrivateNetworkHttpClient`, lower `max_redirects`.
- **TLS off**: `'verify_peer' => false` or `'verify_host' => false` → man-in-the-middle on credentials and webhooks.
