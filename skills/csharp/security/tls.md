---
name: TLS and certificate validation
description: Disabled or weakened TLS in .NET — certificate validation callbacks returning true, callbacks ignoring SslPolicyErrors, SqlClient TrustServerCertificate/Encrypt=false, pinned legacy protocols and client-certificate auth accepting self-signed certificates.
priority: 76
tags: [CWE-295, CWE-297, CWE-319, A04:2025]
activation:
  content:
    - '\b(?:ServerCertificateCustomValidationCallback|DangerousAcceptAnyServerCertificateValidator|RemoteCertificateValidationCallback|ServerCertificateValidationCallback)\b'
    - '\bSslPolicyErrors\b|\bX509(?:Chain|ChainPolicy|RevocationMode)\b|\bSslProtocols\.|\bSecurityProtocolType\.'
    - '[Tt]rust[Ss]erver[Cc]ertificate\s*=\s*(?:[Tt]rue|[Yy]es)|\b[Ee]ncrypt\s*=\s*(?:[Ff]alse|[Nn]o|[Oo]ptional)\b'
    - '\bAllowedCertificateTypes\b|\bAddCertificate\('
sources:
  - https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclienthandler.servercertificatecustomvalidationcallback
  - https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-7.0/breaking-changes
  - https://learn.microsoft.com/en-us/aspnet/core/security/authentication/certauth
---
- **Validation disabled**: `ServerCertificateCustomValidationCallback = (…) => true`, `HttpClientHandler.DangerousAcceptAnyServerCertificateValidator`, `RemoteCertificateValidationCallback`/`ServicePointManager.ServerCertificateValidationCallback` returning `true` → any certificate accepted (MITM); "dev only" code reaches production. Fix: trust the correct CA; test-only handlers behind explicit configuration.
- **Ignoring policy errors**: callbacks that check only thumbprint, subject or issuer name, or accept `RemoteCertificateChainErrors`/`RemoteCertificateNameMismatch` → expired, self-signed or wrong-host certificates pass. Fix: require `SslPolicyErrors.None`, or validate with `X509ChainPolicy.CustomTrustStore`.
- **SQL Server transport**: `TrustServerCertificate=True` (added after Microsoft.Data.SqlClient 4.0 made `Encrypt=true` the default) or `Encrypt=False` in connection strings → unauthenticated TLS or plaintext credentials/data. Fix: a trusted server certificate; `Encrypt=Strict` on SQL Server 2022+.
- **Pinned legacy protocols**: hard-coded `SslProtocols.Tls`/`Tls11` or `SecurityProtocolType` values → downgrade exposure and failures when TLS 1.3 is required. Fix: `SslProtocols.None` (OS defaults).
- **Client-certificate auth**: `AddCertificate` with `AllowedCertificateTypes = All`/`SelfSigned`, `RevocationMode = NoCheck` or an `OnCertificateValidated` that doesn't pin issuers/thumbprints → any self-made certificate authenticates. Fix: chained certificates plus explicit issuer/thumbprint checks.
