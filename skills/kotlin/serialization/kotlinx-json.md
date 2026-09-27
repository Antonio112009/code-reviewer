---
name: kotlinx.serialization JSON
description: kotlinx.serialization Json defaults that break compatibility — unknown keys rejected, defaults not encoded, unknown enum values, static-type serialization dropping subclass fields, the wrong @Transient and Json instances rebuilt per call.
priority: 60
tags: [CWE-502, CWE-200]
activation:
  content:
    - '\bJson\s*\{'
    - '\bJson\.(?:decodeFromString|encodeToString|decodeFromJsonElement|encodeToJsonElement|decodeFromStream)\b'
    - '\b(?:decodeFromString|encodeToString)\s*<'
    - '@Serializable\b'
    - '@Transient\b'
    - '\b(?:ignoreUnknownKeys|encodeDefaults|coerceInputValues|explicitNulls|classDiscriminator)\b'
sources:
  - https://github.com/Kotlin/kotlinx.serialization/blob/master/docs/json.md
  - https://github.com/Kotlin/kotlinx.serialization/blob/master/docs/basic-serialization.md
  - https://github.com/Kotlin/kotlinx.serialization/blob/master/docs/polymorphism.md
---
- **Unknown keys fail**: the default `Json` throws `SerializationException` on unknown keys → a field added by the server breaks every shipped client. Fix: `Json { ignoreUnknownKeys = true }` (or `@JsonIgnoreUnknownKeys`) for external payloads.
- **Defaults not encoded**: properties equal to their default are omitted (`encodeDefaults = false`) → receivers see missing fields or apply different defaults. Fix: `encodeDefaults = true` or `@EncodeDefault` on fields other systems require.
- **Strict values**: `null` or an unknown enum constant for a non-null property throws, as does a missing field without default (`MissingFieldException`) → crash when the server adds an enum value. Fix: defaults plus `coerceInputValues = true`.
- **Static type decides**: encoding an instance through a variable typed as a non-sealed base class writes only the base properties → subclass fields silently dropped. Fix: `sealed` hierarchy or `polymorphic {}` registration; encode with the concrete type.
- **Wrong `@Transient`**: `kotlin.jvm.Transient` is ignored by kotlinx.serialization (it needs `kotlinx.serialization.Transient` plus a default) → secrets or caches still serialized. Fix: import the kotlinx annotation.
- **Json per call**: `Json { … }` built inside functions or loops re-creates configuration and loses the format's serializer caches → CPU/GC cost on hot paths. Fix: one top-level `val json = Json { … }`.
