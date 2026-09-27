---
name: Outbound HTTP clients (reqwest)
description: reqwest/hyper client pitfalls — no default timeouts, a Client built per request, 4xx/5xx treated as success, unbounded response bodies and redirect handling (SSRF re-checks, credential headers on scheme change before 0.13.4).
priority: 60
tags: [CWE-400, CWE-918, CWE-754]
activation:
  content:
    - '\breqwest\b|\bClientBuilder\b|\bureq::'
    - '\.error_for_status(?:_ref)?\(|\bredirect::Policy\b'
    - '\.(?:get|post|put|patch|delete)\([^)\n]{0,120}\)\s*\.(?:json|form|query|header|bearer_auth|basic_auth|timeout|body)\('
sources:
  - https://docs.rs/reqwest/latest/reqwest/struct.ClientBuilder.html
  - https://docs.rs/reqwest/latest/reqwest/struct.Client.html
  - https://docs.rs/reqwest/latest/reqwest/struct.Response.html#method.error_for_status
  - https://github.com/seanmonstar/reqwest/blob/master/CHANGELOG.md
---
- **No timeouts**: `Client::new()` has no total, connect or read timeout → a stalled upstream hangs the task and its pool slot forever. Fix: `ClientBuilder::timeout` plus `connect_timeout`, or a per-request `timeout`.
- **Client per request**: building a `Client` inside handlers or loops discards connection pooling (new DNS and TLS handshake per call, socket churn); `Client::new()` panics if TLS or resolver init fails. Fix: build once and clone (it is an `Arc`).
- **HTTP errors as success**: `send().await?` is `Ok` for 4xx/5xx → error bodies parsed as data, failures ignored. Fix: `.error_for_status()?` before reading.
- **Unbounded bodies**: `.bytes()`, `.text()` and `.json()` buffer the whole (decompressed) response → memory exhaustion from large or hostile upstreams. Fix: check `content_length()`, stream `chunk()`/`bytes_stream()` under a cap.
- **Redirects**: up to 10 redirects are followed by default, so SSRF allow-lists checked only on the first URL are bypassed; reqwest before 0.13.4 kept `Authorization`/`Cookie` on same-host https→http redirects. Fix: `redirect::Policy::none()` or a policy re-validating each hop.
