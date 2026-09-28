---
name: Laravel HTTP client
description: Http facade traps — 4xx/5xx responses not throwing, 30-second default timeouts in web requests, retry() throwing and retrying non-idempotent calls, pool results, disabled TLS verification and user-supplied URLs.
priority: 62
tags: [CWE-252, CWE-400, CWE-295, CWE-918]
activation:
  content:
    - '\bHttp::(?:get|post|put|patch|delete|send|pool|withToken|withHeaders|timeout|retry|asForm|acceptJson|baseUrl|withoutVerifying)\b'
    - '->(?:withoutVerifying|retry|throw|throwIf|successful|failed|json)\s*\('
  examples:
    - '$response = Http::timeout(5)->retry(3, 100)->post(''https://api.example.com/charge'', $payload);'
    - '$response = Http::withoutVerifying()->get($url)->throw()->json();'
sources:
  - https://laravel.com/docs/13.x/http-client#error-handling
  - https://laravel.com/docs/13.x/http-client#timeout
  - https://laravel.com/docs/13.x/http-client#retries
---
- **Errors do not throw**: unlike Guzzle, `Http::get()`/`post()` return normally on 4xx/5xx → error bodies are parsed as data and failed webhooks look delivered. Fix: `->throw()` or check `successful()`/`failed()`.
- **Default timeouts**: 30 seconds per request (10 to connect) → a slow partner API ties up web workers. Fix: explicit `timeout()`/`connectTimeout()` sized for the request path; move slow calls to queues.
- **retry() semantics**: after the last attempt `retry()` throws `RequestException` unless `throw: false`, and it retries POSTs and payments that may already have succeeded. Fix: retry only idempotent calls or send idempotency keys; `when` callbacks for status filtering.
- **Pool results**: `Http::pool()` returns responses in order but a failed connection yields an exception object instead of a response → calling `->json()` on it crashes. Fix: check each result.
- **TLS and URLs**: `withoutVerifying()` disables certificate checks (MITM); passing user-supplied URLs to `Http::get()` enables SSRF to internal services and cloud metadata. Fix: keep verification, allowlist hosts.
