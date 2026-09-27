---
name: .NET 9 behaviour changes
description: Silent runtime behaviour changes code must expect on .NET 9+ — JSON null into JsonDocument, empty vs deleted environment variables, ZipArchive entry-name decoding and BinaryReader.ReadString on malformed data.
priority: 57
activation:
  versions: { lang.csharp: ">=9" }
  content:
    - '\bJsonDocument\b'
    - '\bSetEnvironmentVariable\(|\.Environment\[|\bGetEnvironmentVariable\('
    - '\bZipArchive\b|\bentryNameEncoding\b|\bBinaryReader\b'
sources:
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/serialization/9.0/jsondocument-props
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/9.0/empty-env-variable
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/9.0/ziparchiveentry-encoding
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/9.0/binaryreader
---
- **JSON null into JsonDocument**: deserializing `null` into a `JsonDocument`/`JsonDocument?` property now yields a non-null document with `RootElement.ValueKind == JsonValueKind.Null` → `doc is null`/`?.` checks stop detecting missing data. Fix: also test `ValueKind`.
- **Empty environment variables**: `Environment.SetEnvironmentVariable(name, "")` now sets an empty value instead of deleting it, and `ProcessStartInfo.Environment[name] = null` now removes the variable → `GetEnvironmentVariable(...) != null` checks and child-process configuration change meaning. Fix: pass `null` to delete, check `string.IsNullOrEmpty`.
- **Zip entry names**: when an entry has the UTF-8 flag set, its name/comment are decoded as UTF-8 even if `entryNameEncoding` was supplied (it was always used on .NET 7/8) → names differ from what older code produced or matched. Fix: don't rely on the forced encoding.
- **Malformed strings**: `BinaryReader.ReadString()` returns `"�"` for malformed encoded data instead of an empty string → validation that treated `""` as "bad payload" now accepts replacement characters. Fix: validate explicitly.
