---
name: Crypto crate misuse
description: AEAD nonce reuse, predictable RNGs and rand ≥0.9 fork behaviour, non-constant-time comparisons, bcrypt's 72-byte truncation, fast or weakened password hashing and the unfixed Marvin timing issue in the rsa crate.
priority: 72
tags: [CWE-323, CWE-338, CWE-208, CWE-916, CWE-385]
activation:
  content:
    - '\b(?:aes_gcm|chacha20poly1305|aes_siv)::|\bNonce::|\bgenerate_nonce\('
    - '\b(?:SmallRng|StdRng|ThreadRng|OsRng|SysRng)\b|\bseed_from_u64\b|\bfastrand::|\brand::'
    - '\b(?:bcrypt|argon2|scrypt|pbkdf2)::|\bSha(?:256|512)::digest\('
    - '\brsa::|\bRsaPrivateKey\b|\bPkcs1v15Encrypt\b|\bOaep\b'
    - '\bsubtle::|\bConstantTimeEq\b|\bverify_slice\('
sources:
  - https://docs.rs/aes-gcm/latest/aes_gcm/
  - https://github.com/rust-random/rand/blob/master/CHANGELOG.md
  - https://docs.rs/bcrypt/latest/bcrypt/
  - https://rustsec.org/advisories/RUSTSEC-2023-0071.html
---
- **AEAD nonce reuse**: a constant, counter-reset or copied example nonce (`Nonce::from_slice(b"unique nonce")`) with `aes-gcm`/`chacha20poly1305` under one key → plaintext XOR leaks and forgeries. Fix: a fresh random nonce per message stored with the ciphertext; XChaCha20 for high volumes.
- **Predictable randomness**: `SmallRng`, `StdRng::seed_from_u64(time)`, `fastrand` for tokens, keys or IDs → guessable; rand ≥0.9 has no fork protection, so a `fork()`ed child repeats the parent's `ThreadRng` output. Fix: `OsRng`/`SysRng` (0.10) or `rand::rng()`, reseed after fork.
- **Timing-unsafe comparison**: `==` on HMACs, API keys or reset tokens → timing leaks. Fix: `subtle::ConstantTimeEq`, `Mac::verify_slice`.
- **bcrypt truncation**: `bcrypt::hash` silently uses only the first 72 bytes → long passphrases or pre-peppered inputs collide. Fix: `non_truncating_hash`/`non_truncating_verify`, or Argon2id.
- **Weak password hashing**: `Sha256::digest(password)` or Argon2 with lowered `Params` → brute-forceable leaks. Fix: `argon2::Argon2::default()` (Argon2id) with `PasswordHash` verification.
- **rsa crate timing (Marvin)**: RSA decryption with the `rsa` crate reachable over the network leaks key bits (RUSTSEC-2023-0071, unpatched). Fix: avoid server-side RSA decryption or use aws-lc-rs/ring.
