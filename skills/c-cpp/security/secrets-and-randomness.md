---
name: Secrets in memory and randomness
description: Secret handling in C/C++ — wipes removed as dead stores, non-constant-time comparisons, predictable PRNGs and seeds, unchecked or deterministic secure random sources and modulo bias.
priority: 75
tags: [CWE-14, CWE-208, CWE-338, CWE-330, CWE-252]
activation:
  content:
    - '\b(?:explicit_bzero|memset_s|memset_explicit|SecureZeroMemory|OPENSSL_cleanse|sodium_memzero|CRYPTO_memcmp|timingsafe_bcmp|sodium_memcmp)\s*\('
    - '\b(?:s?rand|random|drand48|lrand48|getrandom|getentropy|arc4random\w*|RAND_bytes|RAND_priv_bytes|BCryptGenRandom)\s*\('
    - '\b(?:mt19937(?:_64)?|default_random_engine|minstd_rand0?|random_device)\b'
    - '\b(?:memset|bzero|memcmp|strcmp|strncmp)\s*\([^;\n]{0,40}(?:[Kk]ey|[Ss]ecret|[Pp]ass|[Tt]oken|[Nn]once|[Mm]ac\b|MAC|[Hh]mac|HMAC|[Dd]igest|[Ss]ignature|[Ss]alt)'
  examples:
    - 'explicit_bzero(key, sizeof(key));'
    - 'if (RAND_bytes(iv, sizeof(iv)) != 1) return -1;'
    - 'std::mt19937 rng(seed);'
    - 'if (memcmp(mac, expected_mac, sizeof(mac)) != 0) return -1;'
sources:
  - https://en.cppreference.com/w/c/string/byte/memset
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/miscellaneous-msc/msc30-c/
  - https://man7.org/linux/man-pages/man2/getrandom.2.html
  - https://en.cppreference.com/w/cpp/numeric/random/random_device
---
- **Wipes that vanish**: `memset`/`bzero` of keys, passwords or plaintext right before `free` or return → removed as a dead store. Fix: `explicit_bzero` (glibc ≥ 2.25), C23 `memset_explicit` (glibc ≥ 2.43), `SecureZeroMemory`, `OPENSSL_cleanse`.
- **Timing leaks**: `memcmp`/`strcmp`/`==` on MACs, tokens, password hashes or signatures stop at the first difference → byte-by-byte guessing. Fix: `CRYPTO_memcmp`, `timingsafe_bcmp`, `sodium_memcmp`.
- **Predictable generators**: `rand`, `random`, `drand48`, `std::mt19937` or `default_random_engine` for keys, tokens, IVs, salts or session ids → recoverable outputs; `srand(time(NULL))` seeds are guessable (MSC30-C). Fix: the OS CSPRNG.
- **Unchecked secure sources**: `getrandom` may return fewer bytes than asked (> 256) or fail with `EINTR`; `std::random_device` was deterministic on MinGW before GCC 9.2 → weak or zero keys. Fix: check and loop; `arc4random_buf` (glibc ≥ 2.36).
- **Modulo bias**: `rand() % n` or `random_byte % n` for PINs, codes or shuffles → non-uniform, more guessable values. Fix: `arc4random_uniform` or rejection sampling.
