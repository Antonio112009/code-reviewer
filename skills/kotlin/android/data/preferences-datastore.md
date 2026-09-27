---
name: SharedPreferences and DataStore
description: Key-value storage defects — mutating the set returned by getStringSet, commit()/apply() blocking the UI thread, large blobs in prefs, multi-process access, several DataStore instances per file, mutable DataStore types, blocking first() reads and unhandled IOException.
priority: 62
tags: [CWE-662, CWE-400]
activation:
  content:
    - '\bgetStringSet\s*\('
    - '\.(?:commit|apply)\s*\(\s*\)'
    - '\bedit\s*\(\s*commit\s*=\s*true'
    - '\bMODE_MULTI_PROCESS\b'
    - '\b(?:preferencesDataStore|dataStore)\s*\('
    - '\b(?:DataStoreFactory|PreferenceDataStoreFactory|MultiProcessDataStoreFactory)\b'
    - '\.(?:updateData|edit)\s*\{'
    - '\.data\.first\s*\('
sources:
  - https://developer.android.com/reference/android/content/SharedPreferences#getStringSet(java.lang.String,%20java.util.Set%3Cjava.lang.String%3E)
  - https://developer.android.com/topic/libraries/architecture/datastore
---
- **Mutating getStringSet**: editing the `Set` returned by `getStringSet` (then saving it back) is forbidden → changes may not persist and stored data can be corrupted. Fix: copy with `toMutableSet()` before editing.
- **UI-thread writes**: `commit()`/`edit(commit = true)` writes to disk on the calling thread; `apply()` defers the write but the UI thread waits on pending fsyncs at lifecycle transitions → jank and ANRs. Fix: DataStore, or write off the main thread.
- **Multi-process**: `MODE_MULTI_PROCESS` is deprecated and unreliable; two processes writing one prefs file lose updates. Fix: `MultiProcessDataStoreFactory`, never mixed with a single-process DataStore on the same file.
- **Several DataStore instances**: `preferencesDataStore(...)` declared inside a class/function or `DataStoreFactory.create` per call → more than one instance for a file → `IllegalStateException` on read/update. Fix: one top-level delegate or singleton.
- **Mutable DataStore type**: `updateData { it.apply { count++ } }` on a mutable `T` → breaks DataStore's consistency guarantees. Fix: immutable types (protobuf, data class `copy()`).
- **Blocking reads**: `runBlocking { dataStore.data.first() }` in `onCreate`/`Application` on the main thread → ANR. Fix: read asynchronously or preload.
- **Unhandled read errors**: `dataStore.data` throws `IOException` (and corruption errors) → crash. Fix: `.catch { if (it is IOException) emit(emptyPreferences()) else throw it }`, `ReplaceFileCorruptionHandler`.
