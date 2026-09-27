---
name: TLS configuration
description: Disabled certificate/hostname verification in reqwest/native-tls/openssl, custom rustls verifiers that accept anything, rustls 0.23 CryptoProvider panics from feature unification and non-verifying database sslmodes.
priority: 72
tags: [CWE-295, CWE-297, CWE-319]
activation:
  content:
    - '\bdanger_accept_invalid_(?:certs|hostnames)\b|\bdangerous\(\)|\bServerCertVerifier\b|\bSslVerifyMode::NONE\b'
    - '\bCryptoProvider\b|\binstall_default\(|\b(?:Client|Server)Config::builder\('
    - '\bsslmode=|\bssl_mode\(|\bPgSslMode::|\bMySqlSslMode::'
    - '\brustls::|\bnative_tls::|\bopenssl::ssl::|\bTlsConnector\b'
sources:
  - https://docs.rs/reqwest/latest/reqwest/struct.ClientBuilder.html#method.danger_accept_invalid_certs
  - https://docs.rs/rustls/latest/rustls/crypto/struct.CryptoProvider.html
  - https://docs.rs/sqlx/latest/sqlx/postgres/enum.PgSslMode.html
---
- **Verification disabled**: `danger_accept_invalid_certs(true)`/`danger_accept_invalid_hostnames(true)` (reqwest, native-tls) or openssl `SslVerifyMode::NONE`, often behind an env flag that reaches production → MITM. Fix: remove; add the private CA as a root instead.
- **Accept-all rustls verifiers**: `.dangerous().with_custom_certificate_verifier(..)` whose `ServerCertVerifier` returns `ServerCertVerified::assertion()` without chain, hostname and signature checks → MITM. Fix: `WebPkiServerVerifier` or the platform verifier; pin by delegating first.
- **CryptoProvider ambiguity**: rustls 0.23 panics at the first `ClientConfig::builder()` when both or neither of `ring` and `aws-lc-rs` end up enabled (feature unification from another dependency). Fix: `CryptoProvider::install_default()` early in `main`.
- **Database TLS that doesn't verify**: Postgres `sslmode` defaults to `prefer` (silent plaintext fallback, no certificate check) and `require` skips verification without a root CA → MITM of DB credentials. Fix: `verify-full` (`PgSslMode::VerifyFull`).
