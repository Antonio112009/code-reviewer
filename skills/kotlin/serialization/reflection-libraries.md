---
name: Gson, Moshi and Jackson with Kotlin
description: Reflection-based JSON libraries breaking Kotlin guarantees — Gson bypassing constructors (nulls in non-null properties, defaults skipped), Moshi adapter ordering and reflection, Jackson without the Kotlin module and null handling for primitives and collections.
priority: 60
tags: [CWE-476, CWE-502]
activation:
  content:
    - '\bGson(?:Builder)?\s*\('
    - '\.fromJson\s*[<(]'
    - '@SerializedName\b'
    - '\bMoshi\.Builder\s*\('
    - '\bKotlinJsonAdapterFactory\b'
    - '@JsonClass\b'
    - '\bObjectMapper\s*\('
    - '\b(?:jacksonObjectMapper|registerKotlinModule|jsonMapper|KotlinModule)\b'
    - '\.readValue\s*[<(]'
  examples:
    - 'val gson = GsonBuilder().create()'
    - 'val user = gson.fromJson<User>(json, User::class.java)'
    - '@SerializedName("user_id") val userId: Int'
    - 'val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()'
    - '@JsonClass(generateAdapter = true) data class User(val id: Int)'
    - 'val mapper = ObjectMapper().registerKotlinModule()'
    - 'val user = mapper.readValue<User>(json)'
sources:
  - https://github.com/google/gson/blob/main/Troubleshooting.md
  - https://github.com/square/moshi/blob/master/README.md
  - https://github.com/FasterXML/jackson-module-kotlin/blob/2.x/README.md
---
- **Gson skips constructors**: classes without a no-arg constructor are allocated via `Unsafe` → defaults and `init` validation skipped; missing keys leave `null`/0 in non-null properties → NPE far from parsing. Fix: kotlinx.serialization or Moshi codegen; `GsonBuilder().disableJdkUnsafe()` fails fast.
- **Moshi order**: `KotlinJsonAdapterFactory` added with `add()` before custom adapters wins over them (first match wins) → custom adapters ignored. Fix: `addLast(KotlinJsonAdapterFactory())`; prefer `@JsonClass(generateAdapter = true)` (reflection needs kotlin-reflect and R8 rules).
- **Jackson without Kotlin module**: a hand-built `ObjectMapper()`/`JsonMapper.builder()` lacks `KotlinModule` → classes without a default constructor fail to deserialize; default values unused. Fix: `jacksonObjectMapper()` / `registerKotlinModule()`.
- **Null into primitives**: with jackson-module-kotlin an explicit JSON `null` for a non-null `Int`/`Boolean` becomes 0/`false`. Fix: enable `DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES`.
- **Null collection elements**: `["a", null]` deserializes into `List<String>` → NPE on use. Fix: `KotlinFeature.StrictNullChecks`.
