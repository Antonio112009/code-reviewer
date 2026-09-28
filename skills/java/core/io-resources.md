---
name: I/O, resources and charsets
description: Leaked streams, readers, JDBC objects and Files.lines/list/walk streams, ignored partial reads, platform-default charsets before JDK 18, closed shared streams, unbounded reads and java.io.File methods that fail silently.
priority: 58
tags: [CWE-772, CWE-252, CWE-838]
activation:
  content:
    - '\bnew\s+(?:File(?:Input|Output)Stream|FileReader|FileWriter|InputStreamReader|OutputStreamWriter|PrintWriter|PrintStream|Scanner|RandomAccessFile|ZipFile)\('
    - '\bFiles\.(?:lines|list|walk|find|newInputStream|newOutputStream|newBufferedReader|newBufferedWriter|readAllBytes|readString|readAllLines)\('
    - '\.read\(\s*\w+\s*[,)]'
    - '\bnew\s+String\(\s*\w+\s*\)|\.getBytes\(\s*\)'
    - '\.(?:delete|mkdirs?|createNewFile)\(\s*\)|\.renameTo\('
    - '\.(?:getConnection|prepareStatement|createStatement|executeQuery)\('
  examples:
    - 'FileInputStream in = new FileInputStream(path);'
    - 'Stream<String> lines = Files.lines(path);'
    - 'int n = in.read(buffer, 0, buffer.length);'
    - 'byte[] raw = payload.getBytes();'
    - 'tempFile.delete();'
    - 'Connection conn = dataSource.getConnection();'
sources:
  - https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html
  - https://openjdk.org/jeps/400
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/InputStream.html
---
- **Unclosed resources**: streams, readers, sockets and JDBC `Connection`/`Statement`/`ResultSet` closed only on the happy path → handle or pool exhaustion after errors. Fix: try-with-resources.
- **Files.lines/list/walk/find**: the returned `Stream` holds an open file or directory handle until closed. Fix: `try (var s = Files.walk(dir)) { … }`.
- **Partial reads**: `in.read(buf)` may fill fewer bytes than requested (−1 at EOF); ignoring the count corrupts data. Fix: `readNBytes`/`readAllBytes` (JDK 9+), `readFully`, or a loop.
- **Default charset**: `new String(bytes)`, `getBytes()`, `FileReader`/`FileWriter`, `InputStreamReader`, `Scanner` without a charset use the platform encoding before JDK 18 (UTF-8 since JEP 400; console I/O excepted) → mojibake between hosts. Fix: `StandardCharsets.UTF_8`.
- **Closing shared streams**: try-with-resources around `System.in`/`System.out`, servlet request/response or socket streams closes them for everyone. Fix: close only streams you opened.
- **Unbounded reads**: `readAllBytes`/`readString`/`readAllLines` on uploads or remote data → `OutOfMemoryError`. Fix: stream with a size limit.
- **Silent File failures**: `File.delete()`, `mkdir(s)`, `renameTo`, `createNewFile` return `false` instead of throwing → ignored failures. Fix: `Files.delete`/`createDirectories`/`move`.
