---
name: Secret comparison, randomness and crypto APIs
description: Loose or timing-unsafe comparison of tokens and hashes, non-CSPRNG token generation, weak password hashing, bcrypt 72-byte truncation and the 8.4 cost change, and openssl_encrypt misuse.
priority: 76
tags: [CWE-697, CWE-208, CWE-338, CWE-916, CWE-327]
activation:
  content:
    - '\b(?:rand|mt_rand|mt_srand|uniqid|lcg_value|str_shuffle|array_rand|random_int|random_bytes)\s*\('
    - '\b(?:md5|sha1|crypt|password_hash|password_verify|hash_hmac|hash_equals|strcmp)\s*\('
    - '\bopenssl_(?:encrypt|decrypt|random_pseudo_bytes)\s*\(|\bRandom\\(?:Randomizer|Engine)'
  examples:
    - '$token = uniqid();'
    - 'if (strcmp($token, $expected) === 0) {'
    - '$cipher = openssl_encrypt($data, ''aes-256-cbc'', $key, 0, $iv);'
sources:
  - https://www.php.net/manual/en/function.hash-equals.php
  - https://www.php.net/manual/en/function.random-bytes.php
  - https://www.php.net/manual/en/function.password-hash.php
  - https://www.php.net/manual/en/function.openssl-encrypt.php
---
- **Loose secret comparison**: `==`/`!=`/`strcmp()` on tokens, HMACs or hashes → magic hashes (`'0e12…' == '0e98…'`), JSON `true == $secret` bypasses, and timing leaks. Fix: `hash_equals($known, (string) $given)`.
- **Predictable randomness**: `rand`, `mt_rand`, `uniqid`, `lcg_value`, `str_shuffle`, `shuffle`, `array_rand`, `md5(time())` for tokens, reset codes, OTPs or file names → guessable. Fix: `random_bytes()`, `random_int()`; `Random\Randomizer` only with the default secure engine.
- **Weak password hashing**: `md5`, `sha1`, `hash('sha256', …)` or custom `crypt()` salts for passwords → fast offline cracking. Fix: `password_hash(PASSWORD_DEFAULT)` plus `password_needs_rehash()`.
- **bcrypt 72-byte limit**: `PASSWORD_BCRYPT` ignores bytes after 72 → long passphrases or `$email . $password` inputs collide. Fix: Argon2id, or pre-hash with HMAC and base64.
- **Cost change (8.4)**: the default bcrypt cost rose from 10 to 12 (about 4× CPU) → login latency and CPU spikes on busy auth endpoints after upgrading; `password_needs_rehash()` rewrites every hash on next login.
- **openssl_encrypt misuse**: ECB modes, fixed or zero IVs, reused GCM nonces, or CBC without a MAC → leaked patterns, forgeable or padding-oracle ciphertexts. Fix: `sodium_crypto_secretbox()` or AES-GCM with a random IV and verified tag.
