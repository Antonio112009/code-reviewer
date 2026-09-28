---
name: Java interop
description: Kotlin/Java boundary defects — null passed into non-null Kotlin parameters, missing @Throws behind proxies, default arguments invisible to Java, per-call SAM wrappers that cannot be removed and read-only lists handed to mutating Java code.
priority: 55
tags: [CWE-476, CWE-755, CWE-401]
activation:
  content:
    - '@Throws\b'
    - '@Jvm(?:Overloads|Static|Field|Name|SuppressWildcards)\b'
    - '\bProxy\.newProxyInstance\b'
    - '\b(?:remove|unregister)\w*(?:Listener|Callback|Callbacks|Observer|Watcher)\s*\('
    - '\bpost(?:Delayed|AtTime)?\s*\(\s*\w+\s*[,)]'
    - '\bthrow\s+(?:IO|SQL|Timeout|Interrupted|Reflective|ClassNotFound)\w*Exception\b'
    - '\bCollections\.(?:sort|shuffle|reverse|swap)\s*\('
  examples:
    - '@Throws(IOException::class)'
    - '@JvmOverloads fun connect(timeout: Long = 5000) {}'
    - 'val proxy = Proxy.newProxyInstance(cl, interfaces, handler)'
    - 'handler.removeCallbacks(runnable)'
    - 'handler.postDelayed(runnable, 1000)'
    - 'throw IOException("connection reset")'
    - 'Collections.sort(mutableList)'
sources:
  - https://kotlinlang.org/docs/java-to-kotlin-interop.html#checked-exceptions
  - https://kotlinlang.org/docs/java-to-kotlin-interop.html#null-safety
  - https://kotlinlang.org/docs/java-to-kotlin-interop.html#overloads-generation
  - https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/reflect/UndeclaredThrowableException.html
---
- **Null into non-null parameters**: public Kotlin functions check non-null parameters on entry → Java callers, reflection, DI or Mockito `any()` passing null get `NullPointerException` at the call. Fix: nullable parameter types on Java-facing APIs; mockito-kotlin matchers.
- **Missing `@Throws`**: a checked exception thrown through a dynamic proxy (`Proxy`, Spring JDK proxies, Retrofit) whose interface doesn't declare it becomes `UndeclaredThrowableException`; Java callers can't catch it. Fix: `@Throws(IOException::class)`.
- **Default arguments**: Java and reflection see only the full-arity method → callers must pass everything; frameworks looking for fewer parameters fail. Fix: `@JvmOverloads` or explicit overloads.
- **SAM wrappers per call**: a function-type value passed as a Java SAM (`Runnable`, listener) is wrapped anew on each call → `removeCallbacks(cb)`/`removeListener(cb)` remove nothing → leaks, duplicate callbacks. Fix: keep one `Runnable { … }` instance.
- **Read-only lists into Java**: `listOf()`/`emptyList()` passed to Java or framework code that adds or removes elements → `UnsupportedOperationException`. Fix: pass `toMutableList()`/`ArrayList`.
