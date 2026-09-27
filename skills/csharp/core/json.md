---
name: System.Text.Json and Newtonsoft pitfalls
description: JSON (de)serialization defects — case-sensitive defaults outside web options, silently missing/unknown members and non-nullable nulls, options created per call, polymorphism dropping data, enum/number formats, cycles, JsonDocument lifetime and attributes from the wrong serializer.
priority: 57
activation:
  content:
    - '\bJsonSerializer\.(?:Serialize|Deserialize)\w*|\bJsonSerializerOptions\b|\bJsonSerializerContext\b'
    - '\[Json\w+|\bJsonConvert\.|using\s+(?:System\.Text\.Json|Newtonsoft\.Json)\b'
    - '\bJson(?:Document|Element|Node)\b|\b(?:ReadFrom|GetFrom|PostAs|PutAs)Json\w*\b'
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/migrate-from-newtonsoft
  - https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/nullable-annotations
  - https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1869
  - https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism
---
- **Case-sensitive defaults**: plain `JsonSerializer.Deserialize` matches names case-sensitively (ASP.NET Core and `System.Net.Http.Json` use web defaults) → `{"userId":1}` leaves `UserId` at 0. Fix: `JsonSerializerOptions.Web` (.NET 9) or `JsonSerializerDefaults.Web`.
- **Silent partial objects**: unknown members ignored, missing ones keep defaults, non-nullable `string`s can be null; .NET 9 `RespectNullableAnnotations` rejects explicit nulls only. Fix: `required`/`[JsonRequired]`, `JsonUnmappedMemberHandling.Disallow` (.NET 8+).
- **Options per call**: `new JsonSerializerOptions { … }` inside methods rebuilds the metadata cache each call (CA1869) → CPU and allocations. Fix: static readonly options or `JsonSerializerContext`.
- **Polymorphism drops data**: serializing through a base/interface type writes base members only (unless `object` or `[JsonDerivedType]`, .NET 7+). Fix: `[JsonPolymorphic]`/`[JsonDerivedType]`.
- **Enums and cycles**: enums serialize as numbers (reordering members changes stored meaning); graphs with back-references throw (`MaxDepth` 64). Fix: `JsonStringEnumConverter`/explicit values, DTOs.
- **JsonDocument lifetime**: undisposed `JsonDocument` leaks pooled buffers; a `JsonElement` used after disposal throws. Fix: `using`, `Clone()`, `JsonElement.Parse` (.NET 10).
- **Wrong attribute namespace**: `Newtonsoft.Json.JsonIgnore`/`JsonProperty` on types serialized by System.Text.Json (or vice versa) are ignored → secrets serialized, names wrong. Fix: the active serializer's attributes.
