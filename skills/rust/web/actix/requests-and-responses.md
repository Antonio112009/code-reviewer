---
name: actix-web requests and responses
description: actix-web request handling — raised or bypassed payload limits, streaming web::Payload without caps, spoofable realip_remote_addr, ResponseError leaking internals and nested web::block results.
priority: 63
tags: [CWE-400, CWE-348, CWE-209, CWE-252]
activation:
  content:
    - '\bweb::(?:Json|Form|Bytes|Payload|Query|Path)\b'
    - '\b(?:JsonConfig|PayloadConfig|FormConfig|QueryConfig)\b'
    - '\brealip_remote_addr\b|\bpeer_addr\b|\bconnection_info\('
    - '\bimpl\s+ResponseError\s+for\b|\berror_response\('
    - '\bweb::block\('
sources:
  - https://docs.rs/actix-web/latest/actix_web/web/struct.JsonConfig.html
  - https://docs.rs/actix-web/latest/actix_web/web/struct.PayloadConfig.html
  - https://docs.rs/actix-web/latest/actix_web/dev/struct.ConnectionInfo.html#method.realip_remote_addr
  - https://docs.rs/actix-web/latest/actix_web/web/fn.block.html
---
- **Raised or bypassed limits**: `JsonConfig` (2 MB default), `PayloadConfig` (256 kB) or `FormConfig` limits raised to huge values, or `web::Payload` chunks accumulated without a cap (it ignores `PayloadConfig`) → memory DoS. Fix: per-route limits; count bytes while streaming.
- **Spoofable client IP**: `realip_remote_addr()` prefers `Forwarded`/`X-Forwarded-For`, which clients set freely unless a trusted proxy overwrites them → bypassed rate limits and IP allow-lists, forged audit logs. Fix: `peer_addr()`, or trust the header only behind your proxy.
- **Leaky `ResponseError`**: `error_response()` or `Display` of wrapped sqlx/io/anyhow errors sent to clients → SQL, paths and internals exposed. Fix: generic bodies, log details, `JsonConfig::error_handler` for extractor errors.
- **Nested `web::block` results**: `web::block(f).await?` only checks the thread-pool error; the closure's own `Result` must still be handled (`.await??`) or failures pass silently.
