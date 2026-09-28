---
name: Randomness, secret comparison and crypto rand changes
description: math/rand for tokens, math/rand.Seed becoming a no-op in Go 1.24, non-constant-time secret comparison, ignored crypto/rand errors on old toolchains and crypto APIs ignoring custom rand readers since Go 1.26.
priority: 76
tags: [CWE-338, CWE-330, CWE-208]
activation:
  content:
    - '"math/rand(?:/v2)?"'
    - '\brand\.(?:Seed|Intn|IntN|Int63n?|Int31n?|Read|Text|New|NewSource|NewPCG|NewChaCha8|Perm|Shuffle|N)\b'
    - '\b(?:hmac\.Equal|subtle\.ConstantTimeCompare)\b'
    - '(?:[Tt]oken|[Ss]ecret|[Ss]ignature|[Aa]pi[Kk]ey|[Hh]mac|[Dd]igest|[Pp]assword)\w{0,20}\s*[!=]=\s'
    - '\b(?:rsa|ecdsa|ed25519|ecdh|dsa)\.GenerateKey\b|\bcryptotest\.'
  examples:
    - 'import "math/rand"'
    - 'token := fmt.Sprintf("%d", rand.Intn(1000000))'
    - 'if !hmac.Equal(sig, expected) {'
    - 'if token == expectedToken {'
    - 'key, err := rsa.GenerateKey(rand.Reader, 2048)'
sources:
  - https://pkg.go.dev/math/rand/v2
  - https://pkg.go.dev/crypto/rand#Text
  - https://go.dev/doc/go1.24
  - https://go.dev/doc/go1.26
---
- **math/rand for secrets**: session IDs, API keys, reset codes, OTPs, nonces or file names from `math/rand` or `math/rand/v2` (auto-seeded is not unpredictable) → guessable values. Fix: `crypto/rand.Text()` (Go 1.24+) or `crypto/rand.Read`.
- **Seed is a no-op (Go 1.24)**: with go.mod `go` ≥ 1.24, top-level `math/rand.Seed` does nothing (`randseednop`) → simulations, sharding or tests expecting a reproducible sequence change every run. Fix: `rand.New(rand.NewSource(seed))`, or `rand.New(rand.NewPCG(s1, s2))` in v2.
- **Timing-unsafe comparison**: `==`, `bytes.Equal` or `strings.EqualFold` on HMACs, webhook signatures, API keys or CSRF tokens → timing oracle. Fix: `hmac.Equal`/`subtle.ConstantTimeCompare` on fixed-length digests (length mismatches return immediately).
- **crypto/rand errors (Go < 1.24)**: ignoring the error from `rand.Read` leaves a zero or partial buffer used as key/nonce. Fix: check the error on older toolchains (1.24+ never returns one).
- **Custom rand ignored (Go 1.26)**: `rsa.GenerateKey`, `ecdsa.GenerateKey/Sign`, `ed25519.GenerateKey` and `rand.Prime` ignore their `io.Reader` → fixtures relying on deterministic keys change each run. Fix: `testing/cryptotest.SetGlobalRandom`; `tls.Config.Rand` is deprecated in 1.27.
