---
name: JCA cryptography defaults
description: Java Cryptography Architecture pitfalls — Cipher.getInstance without mode/padding (ECB, PKCS#1 v1.5), reused GCM IVs, non-cryptographic or explicitly seeded random generators, raw password bytes as keys and non-constant-time MAC comparison.
priority: 74
tags: [CWE-327, CWE-329, CWE-330, CWE-208, A04:2025]
activation:
  content:
    - '\bCipher\.getInstance\('
    - '\bnew\s+(?:Random|SecretKeySpec|GCMParameterSpec|IvParameterSpec)\('
    - '\bMath\.random\(|\bThreadLocalRandom\b'
    - '\bSecureRandom\b'
    - '\b(?:Mac|MessageDigest|Signature|KeyGenerator)\.getInstance\('
  examples:
    - 'Cipher cipher = Cipher.getInstance("AES");'
    - 'SecretKeySpec key = new SecretKeySpec(keyBytes, "AES");'
    - 'double r = Math.random();'
    - 'SecureRandom random = new SecureRandom();'
    - 'MessageDigest digest = MessageDigest.getInstance("SHA-256");'
sources:
  - https://docs.oracle.com/en/java/javase/25/security/java-cryptography-architecture-jca-reference-guide.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/MessageDigest.html
  - https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
---
- **Default mode/padding**: `Cipher.getInstance("AES")` means `AES/ECB/PKCS5Padding` with SunJCE → equal blocks leak patterns; `"RSA"` defaults to PKCS#1 v1.5 padding. Fix: `AES/GCM/NoPadding`, `RSA/ECB/OAEPWithSHA-256AndMGF1Padding`.
- **GCM IV reuse**: a constant or static IV, counters reset on restart, or one `GCMParameterSpec` reused with the same key → keystream reuse and forgeable tags. Fix: a fresh random 12-byte IV per encryption, stored with the ciphertext.
- **Weak randomness**: `new Random()`, `Math.random()` or `ThreadLocalRandom` for tokens, reset codes, session ids, salts or IVs → predictable values. Fix: `SecureRandom`.
- **Seeded SecureRandom**: `SecureRandom.getInstance("SHA1PRNG")` with `setSeed(x)` before first use (or any fixed seed) → a deterministic, repeatable stream. Fix: default `new SecureRandom()` without seeding.
- **Password as key**: `new SecretKeySpec(password.getBytes(), "AES")` or a truncated password hash → brute-forceable keys and wrong key lengths. Fix: PBKDF2 via `SecretKeyFactory` with a random salt, or a KMS-managed key.
- **Timing-unsafe comparison**: MACs, signatures, API keys or tokens compared with `Arrays.equals`/`String.equals` → byte-by-byte timing leak. Fix: `MessageDigest.isEqual`.
