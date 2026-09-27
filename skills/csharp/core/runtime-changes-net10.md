---
name: .NET 10 behaviour changes
description: Silent runtime behaviour changes code must expect on .NET 10+ — no default SIGTERM handling for host-less apps, XmlSerializer serializing [Obsolete] members, System.Text.Json metadata-name conflicts and BufferedStream.WriteByte no longer flushing.
priority: 58
activation:
  versions: { lang.csharp: ">=10" }
  content:
    - '\bProcessExit\b|\.Unloading\s*\+=|\bPosixSignalRegistration\b|\bCancelKeyPress\b'
    - '\bXmlSerializer\b|\[Obsolete\b'
    - '\[JsonPolymorphic\b|\bTypeDiscriminatorPropertyName\b|\bReferenceHandler\.Preserve\b'
    - '\bBufferedStream\b'
sources:
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/10.0/sigterm-signal-handler
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/serialization/10/xmlserializer-obsolete-properties
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/serialization/10/property-name-validation
  - https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/10.0/bufferedstream-writebyte-flush
---
- **No default SIGTERM handling**: the runtime no longer turns SIGTERM (Windows close/shutdown events) into a graceful exit → console/worker apps without the Generic Host relying on `AppDomain.ProcessExit` or `AssemblyLoadContext.Unloading` for cleanup are killed immediately on `docker stop`/scale-in (unflushed data, no checkpoint). Fix: Generic Host (`UseConsoleLifetime`) or `PosixSignalRegistration.Create(PosixSignal.SIGTERM, …)`.
- **XmlSerializer and [Obsolete]**: members marked `[Obsolete]` are now serialized (previously ignored like `[XmlIgnore]`); `[Obsolete(..., error: true)]` makes serializer creation throw → payloads gain fields, possibly sensitive ones. Fix: explicit `[XmlIgnore]`.
- **JSON metadata-name conflicts**: a property whose name collides with a polymorphic discriminator (`TypeDiscriminatorPropertyName`) or `$type`/`$id`/`$ref` now throws at serialization instead of emitting duplicate properties. Fix: rename or `[JsonIgnore]` the member.
- **BufferedStream.WriteByte**: no longer flushes implicitly when the buffer fills → code that wrote byte-by-byte and never called `Flush()`/`Dispose()` loses data. Fix: flush or dispose deterministically.
