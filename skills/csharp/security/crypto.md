---
name: Cryptography APIs
description: Misused .NET crypto APIs — System.Random for secrets, weak PBKDF2/Identity hashing parameters, non-constant-time comparisons, ECB/static-IV/unauthenticated AES and reused AesGcm nonces, and RSA PKCS#1 v1.5 encryption.
priority: 74
tags: [CWE-330, CWE-916, CWE-208, CWE-327, CWE-323, A04:2025]
activation:
  content:
    - '\bnew\s+Random\(|\bRandom\.Shared\b|\bRandomNumberGenerator\b'
    - '\bRfc2898DeriveBytes\b|\bPbkdf2\b|\bPasswordHasher(?:Options)?\b|\bCompatibilityMode\b'
    - '\b(?:MD5|SHA1|SHA256|SHA512|HMACSHA\d+)\.(?:Create|HashData)\(|\bSequenceEqual\(|\bFixedTimeEquals\b'
    - '\bAes(?:Gcm|Ccm|Managed|Cng)?\b|\bCipherMode\.|\bRSAEncryptionPadding\b|\.(?:Encrypt|Decrypt)\('
sources:
  - https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.randomnumbergenerator
  - https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib0060
  - https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.cryptographicoperations.fixedtimeequals
  - https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
---
- **Predictable secrets**: `new Random()`/`Random.Shared` for tokens, reset codes, API keys, salts or nonces → attacker can predict them. Fix: `RandomNumberGenerator.GetBytes`/`GetInt32`, `GetHexString`/`GetString` (.NET 8+).
- **Weak password hashing**: plain `SHA256`/`MD5` of passwords; legacy `new Rfc2898DeriveBytes(pwd, salt)` defaults to SHA-1 × 1,000 (obsolete; all ctors SYSLIB0060 in .NET 10); `PasswordHasherOptions.CompatibilityMode = IdentityV2` → fast cracking. Fix: `Rfc2898DeriveBytes.Pbkdf2` SHA-256 ≥ 600k iterations or Identity V3.
- **Timing leaks**: `==`, `string.Equals`, `SequenceEqual` on MACs, signatures, API keys or reset tokens → byte-by-byte timing oracle. Fix: `CryptographicOperations.FixedTimeEquals`.
- **AES modes**: `CipherMode.ECB`, constant/zero IVs with CBC, CBC without a MAC (padding oracle), or a reused `AesGcm` nonce under one key → plaintext recovery and forgery. Fix: `AesGcm` with a fresh 12-byte nonce per message and an explicit tag size.
- **RSA encryption padding**: `RSA.Encrypt(data, RSAEncryptionPadding.Pkcs1)` → Bleichenbacher-style padding oracles when errors are observable. Fix: `RSAEncryptionPadding.OaepSHA256`.
