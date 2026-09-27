---
name: Data Protection key ring
description: ASP.NET Core Data Protection defects — ephemeral keys in containers, key rings not shared between instances or with different application names, keys unprotected at rest, IDataProtector used for long-term storage and purpose strings reused across features.
priority: 68
tags: [CWE-320, CWE-311, CWE-345]
activation:
  content:
    - '\bAddDataProtection\(|\bIDataProtect(?:or|ionProvider)\b|\bITimeLimitedDataProtector\b'
    - '\bPersistKeysTo\w+\(|\bProtectKeysWith\w+\(|\bSetApplicationName\(|\bSetDefaultKeyLifetime\('
    - '\bCreateProtector\(|\bToTimeLimitedDataProtector\('
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/default-settings
  - https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview
  - https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/consumer-apis/purpose-strings
---
- **Ephemeral keys**: containers/Linux hosts without `PersistKeysTo*` keep keys in memory or a throwaway folder → every restart or deploy logs users out and breaks antiforgery tokens and stored `Protect` payloads. Fix: persist to a volume, Redis, blob storage or `PersistKeysToDbContext`.
- **Instances not sharing keys**: replicas without a common key repository, or with different `SetApplicationName` values (the discriminator defaults to the content-root path) → cookies from one instance rejected by another (random logouts, 400s). Fix: shared repository and a fixed application name.
- **Keys unprotected at rest**: configuring a custom repository disables automatic at-rest encryption → anyone reading the share/blob/table can forge auth cookies. Fix: `ProtectKeysWithCertificate`/`ProtectKeysWithAzureKeyVault`/DPAPI.
- **Long-term storage**: `IDataProtector.Protect` for data kept for years (tokens, PII in the DB) → readable only while old keys stay in the ring (keys rotate every 90 days); pruning keys loses the data. Fix: dedicated at-rest encryption.
- **Purpose reuse**: one purpose string for different payload kinds → a token minted for feature A (e.g. e-mail confirmation) is accepted by feature B (password reset). Fix: unique purposes per use; `ToTimeLimitedDataProtector` for expiring tokens.
