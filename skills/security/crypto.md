---
name: Cryptography misuse
description: Cryptographic API misuse, such as fast password hashes, non-CSPRNG or time-based tokens, weak cipher modes, nonce reuse, AEAD tag handling, raw keys, non-constant-time compares, hash-as-MAC, unchecked signature results and disabled certificate or hostname verification.
category: security
priority: 70
tier: essential
tags:
  - CWE-916
  - CWE-338
  - CWE-327
  - CWE-329
  - CWE-323
  - CWE-353
  - CWE-321
  - CWE-208
  - CWE-347
  - CWE-295
  - OWASP-A04
activation:
  content:
    - \b(?:createCipheriv|createDecipheriv|createHash|createHmac|createSign|createVerify|timingSafeEqual|randomBytes|pbkdf2(?:Sync)?|scrypt(?:Sync)?|setAuthTag|getAuthTag)\b|\bcrypto\.subtle\b|\bsubtle\.(?:encrypt|decrypt|sign|verify|importKey|deriveKey)\(
    - \b(?:hashlib|compare_digest|Crypto\.Cipher|cryptography\.hazmat|AESGCM|Fernet|javax\.crypto|MessageDigest|SecretKeySpec|IvParameterSpec|GCMParameterSpec|SecureRandom|System\.Security\.Cryptography|AesGcm|Rfc2898DeriveBytes|RandomNumberGenerator|sodium_\w+|RAND_bytes|EVP_\w+|hash_equals)\b|\bCipher\.getInstance\(|"crypto/(?:aes|cipher|hmac|rand|rsa|ecdsa|ed25519|subtle|tls|md5|sha1|sha256)"|\bopenssl_(?:encrypt|decrypt|sign|verify)\(
    - \b(?:MD5|md5|SHA1|sha1|ECB|bcrypt|argon2|rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity|CERT_NONE|check_hostname|CURLOPT_SSL_VERIFY(?:PEER|HOST))\b|\bMath\.random\(\)\.toString\(|\brandom\.choices?\(\s*string\.|\buuid(?:\.uuid|v)?[17]\(
  examples:
    - 'const hash = crypto.createHash("sha256").update(data).digest("hex");'
    - 'digest = hashlib.sha256(data).hexdigest()'
    - 'const agent = https.request(url, { rejectUnauthorized: false });'
---
- **Password hashing**: MD5, SHA-*, HMAC (even salted) or low-iteration PBKDF2 for passwords → fast cracking. Fix: Argon2id, scrypt, bcrypt; MD5/SHA-1 for cache keys or ETags is fine.
- **Weak randomness**: `Math.random`, `random`, `java.util.Random`, `math/rand`, time seeds, UUIDv1/v7 or hashed timestamps as keys, IVs, tokens or OTPs → predictable. Fix: platform CSPRNG.
- **Weak modes**: ECB (Java `Cipher.getInstance("AES")` default), CBC/CTR without a MAC, MAC-then-encrypt, distinguishable padding errors → pattern leaks, padding oracle. Fix: AES-GCM, ChaCha20-Poly1305.
- **Nonce reuse**: constant or key-derived IVs, reset counters, random 96-bit GCM nonces past ~2^32 messages per key → keystream reuse, forgery. Fix: fresh nonce per message.
- **AEAD tags**: Node `setAuthTag` without `authTagLength` (short tags accepted before Node 26), `update()` output used before `final()` verifies → forged data accepted. Fix: 16-byte tags, discard on failure.
- **Raw keys**: passwords or `sha256(password)` as keys, one key for encryption and MAC → brute force, cross-protocol attacks. Fix: HKDF/Argon2 with salt, per-purpose keys.
- **Timing compare**: `==`, `equals` or `memcmp` on MACs, signatures or tokens → timing oracle. Fix: `timingSafeEqual` (equal lengths), `compare_digest`, `hash_equals`.
- **Hash as MAC**: `sha256(secret + msg)` (length extension), unseparated concatenation before hashing or signing → forgery. Fix: HMAC, length-prefixed encoding.
- **Signature results**: truthy checks on `openssl_verify`/`EVP_DigestVerifyFinal` (−1 on error), ignored `verify()` results, RSA PKCS#1 v1.5 encryption → forgery, padding oracles. Fix: `== 1`, OAEP.
- **Verification off**: `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, no-op `checkServerIdentity`, `CERT_NONE`, `check_hostname=False` → MITM. Fix: verify against a CA bundle.
