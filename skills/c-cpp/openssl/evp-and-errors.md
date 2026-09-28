---
name: OpenSSL EVP results and 3.x changes
description: OpenSSL crypto API traps — verify functions returning negative errors, AEAD tag handling, plaintext used before authentication, RAND_bytes failures, legacy algorithms needing a provider and read-only cached keys since 3.0.
priority: 80
tags: [CWE-347, CWE-252, CWE-354]
activation:
  content:
    - '\bEVP_\w+\s*\('
    - '\b(?:RAND_bytes|RAND_priv_bytes|OSSL_PROVIDER_load|EVP_PKEY_get[01]_\w+)\s*\('
    - '\bEVP_CTRL_(?:AEAD|GCM|CCM)_\w+|\bOPENSSL_VERSION_NUMBER\b'
  examples:
    - 'if (EVP_DigestVerifyFinal(ctx, sig, siglen) == 1) {'
    - 'if (RAND_bytes(iv, sizeof(iv)) != 1) return -1;'
    - 'EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_TAG, 16, tag);'
    - '#if OPENSSL_VERSION_NUMBER < 0x30000000L'
sources:
  - https://docs.openssl.org/3.5/man3/EVP_DigestVerifyInit/
  - https://docs.openssl.org/3.5/man3/EVP_EncryptInit/
  - https://docs.openssl.org/3.5/man3/RAND_bytes/
  - https://docs.openssl.org/3.5/man7/ossl-guide-migration/
---
- **Tri-state verify results**: `EVP_DigestVerifyFinal`/`EVP_DigestVerify` return 1 only for a valid signature, 0 for a bad one and other values on errors (`EVP_VerifyFinal`: -1) → `if (EVP_DigestVerifyFinal(…))` accepts errors. Fix: compare `== 1`.
- **AEAD tags**: GCM/CCM/OCB decryption must set the expected tag (`EVP_CTRL_AEAD_SET_TAG`) before `EVP_DecryptFinal_ex` and check its result; tag lengths taken from input (1–16 bytes allowed) enable forgery. Fix: fixed 16-byte tags.
- **Plaintext before authentication**: `EVP_DecryptUpdate` output arrives before the tag is verified → acting on it processes forged data. Fix: buffer until `EVP_DecryptFinal_ex` returns 1.
- **RAND_bytes failures**: returns 1 on success, 0 or -1 otherwise; ignoring it leaves keys and IVs uninitialized or predictable. Fix: check `== 1`.
- **3.0 legacy algorithms**: MD4, RC4, DES, Blowfish and similar need the legacy provider; otherwise `EVP_CIPHER_fetch` returns NULL and `EVP_EncryptInit_ex`/`EVP_DigestInit_ex` fail → unchecked code continues with an unusable context. Fix: check init results.
- **3.0 cached keys**: `EVP_PKEY_get0_RSA`-style getters return cached copies of provider keys, so changes made through them are lost. Fix: treat them as read-only; build keys with `EVP_PKEY_fromdata`.
