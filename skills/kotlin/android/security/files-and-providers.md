---
name: Content and file providers
description: File-sharing and provider flaws — broad FileProvider paths and URI grants, path traversal in openFile and received file names, selection SQL injection in ContentProviders, zip slip, and dynamic code or native libraries loaded from writable files.
priority: 70
tags: [CWE-22, CWE-89, CWE-73, CWE-94]
activation:
  content:
    - '<(?:root-path|external-path|external-files-path|files-path|cache-path)\b'
    - '\bFileProvider\b'
    - '\bContentProvider\b'
    - '\boverride\s+fun\s+(?:openFile|query|insert|update|delete)\s*\('
    - '\bFLAG_GRANT_(?:READ|WRITE|PERSISTABLE|PREFIX)_URI_PERMISSION\b'
    - '\bOpenableColumns\.DISPLAY_NAME\b'
    - '\b(?:ZipInputStream|ZipFile|ZipPathValidator)\b'
    - '\b(?:DexClassLoader|PathClassLoader|InMemoryDexClassLoader)\b|\bSystem\.load\s*\('
  examples:
    - '<files-path name="shared" path="shared/" />'
    - 'FileProvider.getUriForFile(context, authority, file)'
    - 'class DocsProvider : ContentProvider() {'
    - 'override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {'
    - 'intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)'
    - 'val name = cursor.getString(cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME))'
    - 'ZipInputStream(input).use { zip -> extractEntries(zip) }'
    - 'val loader = DexClassLoader(dexPath, optimizedDir, null, parent)'
sources:
  - https://developer.android.com/privacy-and-security/risks/file-providers
  - https://developer.android.com/privacy-and-security/risks/path-traversal
  - https://developer.android.com/privacy-and-security/risks/untrustworthy-contentprovider-provided-filename
  - https://developer.android.com/privacy-and-security/risks/zip-path-traversal
---
- **Broad FileProvider paths**: `<root-path>`, `path="."`/`"/"` or a broad `<external-path>` in the paths XML → a granted URI can reach the app sandbox or SD card. Fix: narrow `files-path`/`cache-path` subdirectories.
- **Over-granted URIs**: write grants where read suffices, grants on URIs taken from incoming intents, or persistable grants → other apps modify or keep access to private files. Fix: minimal explicit grants.
- **openFile traversal**: `openFile`/`openAssetFile` building a `File` from `uri.lastPathSegment`/`uri.path` (decoded `..%2F`) → reads or writes outside the shared directory. Fix: canonical path must stay under the base dir.
- **Provider SQL injection**: `query(… selection …)` concatenating caller input, or passing `projection`/`sortOrder` straight to SQLite → other apps read any table. Fix: `selectionArgs`, `SQLiteQueryBuilder` with `setStrict(true)` and a projection map.
- **Trusted display names**: saving a received file under `OpenableColumns.DISPLAY_NAME` → `../shared_prefs/…` overwrites app files. Fix: generate your own file name.
- **Zip slip**: extracting `ZipEntry.name` without checking the resolved path, or calling `ZipPathValidator.clearCallback()` (the targetSdk 34 guard) → files written anywhere in the sandbox. Fix: canonical-path check per entry.
- **Code from writable files**: `DexClassLoader`/`System.load` on files in external or writable dirs → code injection; targetSdk 34 requires read-only DEX/JAR files and targetSdk 37 read-only native libs (`UnsatisfiedLinkError`). Fix: ship code in the APK.
