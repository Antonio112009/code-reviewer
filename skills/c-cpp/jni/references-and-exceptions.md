---
name: JNI references, exceptions and threads
description: JNI calls whose NULL results or pending exceptions go unchecked, JNIEnv or local references kept beyond their scope, local references piling up in loops, unreleased array and string buffers, and 32-bit length truncation.
priority: 72
tags: [CWE-476, CWE-401, CWE-362, CWE-252]
activation:
  content:
    - '->\s*(?:FindClass|GetObjectClass|Get(?:Static)?(?:Method|Field)ID|New(?:Object|StringUTF|\w{0,12}Array)|Call\w{0,24}Method|Get\w{0,16}ArrayElements|GetStringUTFChars|GetPrimitiveArrayCritical|NewGlobalRef|DeleteLocalRef|ExceptionCheck)\s*\('
    - '\bJNIEnv\s*\*\s*\w{1,40}\s*;'
  examples:
    - 'jmethodID read = env->GetMethodID(cls, "read", "([BII)I");'
    - '    JNIEnv *m_env;'
sources:
  - https://docs.oracle.com/en/java/javase/21/docs/specs/jni/functions.html
  - https://docs.oracle.com/en/java/javase/21/docs/specs/jni/design.html
  - https://developer.android.com/training/articles/perf-jni
---
- **NULL results unchecked**: `FindClass`, `GetObjectClass`, `GetMethodID`/`GetFieldID`, `NewStringUTF`, `NewByteArray` return NULL with an exception pending (missing class or method, out of memory) → the next call on it crashes. Fix: check and return to Java.
- **Pending exception ignored**: after `Call*Method`, `NewObject` or an allocation that threw, further JNI calls other than cleanup are undefined → crash or a lost error. Fix: `ExceptionCheck()` after each call that can throw.
- **Cached `JNIEnv*`**: it is valid only on its own thread; storing it in a field or static and using it from a callback or worker thread is undefined behaviour. Fix: keep the `JavaVM*`, use `GetEnv`/`AttachCurrentThread`.
- **Local reference kept**: a `jclass`/`jobject` from a native call stored in a field or static is invalid once that call returns. Fix: `NewGlobalRef` it, `DeleteGlobalRef` in the destructor.
- **Local references in loops**: `GetObjectClass`, `NewStringUTF`, `GetObjectArrayElement` in a loop or long-running native thread without `DeleteLocalRef`/`PushLocalFrame` → local reference table overflow, abort. Fix: delete each one.
- **Buffers not released**: `Get*ArrayElements`/`GetStringUTFChars` without the matching `Release*` on every path, error paths included, or with the wrong mode (`JNI_ABORT` drops writes) → leaks, lost data. Fix: release on all paths.
- **Critical regions**: other JNI calls, allocations or blocking between `GetPrimitiveArrayCritical` and its release → deadlocks, stalled GC. Fix: copy out or keep the region minimal.
- **32-bit lengths**: `jsize` is a signed 32-bit int; `size_t` or 64-bit sizes passed to `NewByteArray`/`Set*ArrayRegion` truncate or go negative → wrong copies, exceptions. Fix: range-check first.
