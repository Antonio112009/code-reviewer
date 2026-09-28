---
name: R8 and keep rules
description: Release-only crashes and data loss from code shrinking — reflection without keep rules, R8 full-mode defaults (AGP 8) and strict keep rules (AGP 9), stripped Kotlin metadata, obfuscated JSON field names, over-broad keeps and libraries without consumer rules.
priority: 64
tags: [CWE-704, CWE-1188]
activation:
  files: ["**/*.pro"]
  content:
    - '^\s*-(?:keep\w*|dontobfuscate|dontoptimize|dontshrink|assumenosideeffects)\b'
    - '\b(?:isMinifyEnabled|minifyEnabled|consumerProguardFiles|proguardFiles)\b'
    - '\bandroid\.(?:enableR8\.fullMode|r8\.\w+)\b'
    - '@Keep\b'
    - '\bClass\.forName\s*\(|\bgetDeclared(?:Constructor|Method|Field)\s*\('
    - '\bTypeToken\s*<'
  examples:
    - '-keep class com.example.model.User { *; }'
    - 'isMinifyEnabled = true'
    - 'android.r8.strictFullModeForKeepRules=true'
    - '@Keep class UserResponse(val id: Int)'
    - 'val clazz = Class.forName(className)'
    - 'val type = object : TypeToken<List<User>>() {}.type'
sources:
  - https://developer.android.com/topic/performance/app-optimization/full-mode
  - https://developer.android.com/topic/performance/app-optimization/add-keep-rules
  - https://developer.android.com/build/releases/agp-9-0-0-release-notes
  - https://github.com/google/gson/blob/main/Troubleshooting.md
---
- **Reflection without keeps**: classes reached only via reflection (`Class.forName`, JNI callbacks, reflective serializers) are renamed or removed → `ClassNotFoundException`, empty objects only in release. Fix: `@Keep` or targeted `-keep` rules.
- **Full mode (AGP 8+ default)**: no-arg constructors aren't implicitly kept and `Signature`/annotations survive only on kept classes → `newInstance()` fails, Gson `TypeToken<List<T>>` (< 2.11) breaks. Fix: `-keepattributes Signature`, targeted keeps, newer libraries.
- **AGP 9 strict keep rules**: `android.r8.strictFullModeForKeepRules` is on by default → `-keep class X` no longer keeps `X()`. Fix: `-keep class X { <init>(); }` for reflectively created classes.
- **Kotlin metadata**: kotlin-reflect, jackson-module-kotlin or Moshi reflection without `kotlin.Metadata` and `RuntimeVisibleAnnotations` kept → `KotlinReflectionInternalError` in release. Fix: keep them, or use codegen.
- **Obfuscated JSON names**: Gson/reflection models without `@SerializedName` serialize obfuscated field names → JSON cached on disk becomes unreadable after the next release changes the mapping. Fix: explicit serialized names.
- **Over-broad keeps**: `-keep class com.example.** { *; }`, `-dontobfuscate` or `-dontoptimize` added to silence a crash → shrinking and obfuscation off app-wide (AGP 9 rejects such options in consumer rules). Fix: narrow rules.
- **Libraries without consumer rules**: an Android library that relies on reflection but ships no `consumerProguardFiles` → every app using it crashes in release. Fix: publish `consumer-rules.pro`.
