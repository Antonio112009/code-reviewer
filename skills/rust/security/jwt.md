---
name: JWT validation (jsonwebtoken)
description: jsonwebtoken validation pitfalls — signature checks disabled, algorithm taken from the token header, audience/issuer not enforced, exp/nbf handling, weak HMAC secrets and the 10.x crypto-backend runtime panic.
priority: 72
tags: [CWE-347, CWE-287, CWE-613, CWE-327]
activation:
  content:
    - '\bjsonwebtoken::|\bValidation::(?:new|default)\b|\bdecode_header\('
    - '\b(?:Encoding|Decoding)Key::'
    - '\binsecure_(?:decode|disable_signature_validation)\b|\bdangerous::'
    - '\b(?:validate_(?:exp|nbf|aud)|required_spec_claims|set_(?:audience|issuer))\b'
  examples:
    - 'let mut validation = Validation::new(Algorithm::HS256);'
    - 'let key = DecodingKey::from_secret(secret.as_bytes());'
    - 'let claims = jsonwebtoken::dangerous::insecure_decode(&token)?;'
    - 'validation.set_audience(&["my-service"]);'
sources:
  - https://docs.rs/jsonwebtoken/latest/jsonwebtoken/struct.Validation.html
  - https://github.com/Keats/jsonwebtoken/blob/master/CHANGELOG.md
  - https://www.rfc-editor.org/rfc/rfc8725#section-3.1
---
- **Signature not verified**: `insecure_disable_signature_validation()` (≤10.x), `dangerous::insecure_decode` (≥10.1) or trusting `decode_header` claims → forged tokens accepted. Fix: always `decode` with a key.
- **Algorithm chosen by the token**: `Validation::new(header.alg)` built from the unverified `decode_header` lets the token pick the algorithm instead of the server; with `kid`-selected keys this invites key/algorithm confusion. Fix: fixed expected algorithm(s) per key.
- **Audience and issuer**: `iss` is not checked unless `set_issuer` is called; `validate_aud = false` accepts tokens minted for other services (≥9 rejects tokens carrying `aud` when none is configured). Fix: `set_audience` and `set_issuer`.
- **Expiry handling**: `exp` is required and checked with 60 s leeway by default, but `nbf` is not (`validate_nbf = false`); dropping `exp` from `required_spec_claims` or `validate_exp = false` yields non-expiring tokens.
- **Weak HMAC secrets**: `EncodingKey::from_secret(b"secret")` or short hard-coded keys → offline brute force. Fix: ≥256-bit random secret from secret storage.
- **Crypto backend (≥10)**: without exactly one of the `aws_lc_rs`/`rust_crypto` features (or a custom provider), `encode`/`decode` panic at runtime. Fix: enable one backend feature.
