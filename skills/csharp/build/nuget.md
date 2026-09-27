---
name: NuGet restore, audit and feeds
description: PackageReference, Directory.Packages.props and nuget.config changes that silence vulnerability audit, float or omit versions, or let packages come from unintended or plaintext feeds; plus package versions with known problems.
priority: 60
tags: [CWE-1104, CWE-829, CWE-494, A03:2025]
activation:
  content:
    - '<(?:PackageReference|PackageVersion|GlobalPackageReference)\b'
    - '\bNuGetAudit\w*|\bNU1[89]\d\d\b'
    - '<(?:packageSources?|packageSourceMapping|clear)\b|\ballowInsecureConnections\b'
    - '\b(?:RestorePackagesWithLockFile|RestoreLockedMode|ManagePackageVersionsCentrally|VersionOverride)\b'
sources:
  - https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/10.0/nugetaudit-transitive-packages
  - https://learn.microsoft.com/en-us/nuget/consume-packages/package-source-mapping
  - https://learn.microsoft.com/en-us/nuget/concepts/dependency-resolution
---
- **Audit silenced**: `<NuGetAudit>false</NuGetAudit>`, `NU1901`–`NU1904` in `NoWarn`/`WarningsNotAsErrors`, or broad `<NuGetAuditSuppress>` → known-vulnerable packages restore silently. The .NET 8+ SDK audits direct packages; transitive ones only by default for net10.0+ targets (`NuGetAuditMode=all`).
- **Floating or open versions**: `Version="*"`/`"1.*"` take whatever is newest at restore; ranges like `[1.2,)` resolve the lowest match, not the latest → non-reproducible or stale builds. Fix: exact versions; `RestorePackagesWithLockFile` + locked-mode restore in CI.
- **Missing version**: `PackageReference` without `Version` outside Central Package Management restored the lowest available version with only warning NU1604 before .NET 10 (error NU1015 since).
- **Dependency confusion**: nuget.config adds a private feed without `<clear/>` and without `<packageSourceMapping>` → an internal package id can be satisfied by a same-named public package. Fix: clear inherited sources, map id prefixes to feeds.
- **Plain-HTTP feed**: `http://` sources with `allowInsecureConnections="true"` → packages can be tampered with in transit. Fix: HTTPS feeds only.
- **Problem versions**: Moq 4.20.0–4.20.1 ran SponsorLink at build and sent hashed git e-mails (GHSA-6r78-m64m-qwcf); FluentAssertions 8+ requires a paid licence for commercial use (7.x stays Apache-2.0).
