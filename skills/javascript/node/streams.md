---
name: Streams and backpressure
description: pipe() without error propagation, ignored write() backpressure, async 'data' handlers, missing 'error' listeners, unbounded buffering, and multibyte or record boundaries split across chunks (64 KiB default since Node 22).
priority: 60
tags: [CWE-400, CWE-404]
activation:
  content:
    - '\.pipe\s*\(|\bpipeline\s*\(|\bstream/promises\b'
    - '\.on\s*\(\s*[''"](?:data|readable|end|finish|drain)[''"]'
    - '\bcreate(?:Read|Write)Stream\s*\(|\bnew\s+(?:Readable|Writable|Transform|Duplex|PassThrough)\b|\bReadable\.from\s*\('
    - '\.write\s*\(|\bhighWaterMark\b|\.toArray\s*\(\s*\)'
sources:
  - https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options
  - https://nodejs.org/api/stream.html#event-drain
  - https://nodejs.org/api/stream.html#readablepipedestination-options
  - https://nodejs.org/en/learn/modules/backpressuring-in-streams
---
- **`pipe()` without error handling**: `src.pipe(dest)` neither forwards errors nor destroys the other stream → leaked file descriptors, hung responses, crashes on unhandled `'error'`. Fix: `await pipeline(src, …, dest)` from `node:stream/promises`.
- **Ignored backpressure**: writing in a loop without checking `write()`'s return value buffers everything in memory (large exports, proxies) → OOM. Fix: `await once(stream, 'drain')` when it returns `false`, or `pipeline` from a generator.
- **Async `'data'` handlers**: `readable.on('data', async (c) => db.insert(c))` doesn't pause the source → unbounded concurrency, out-of-order writes, unhandled rejections. Fix: `for await (const chunk of readable)` or a `Writable`.
- **Missing `'error'` listeners**: a stream emitting `'error'` without a listener (ENOENT on read, client disconnect) crashes the process. Fix: `pipeline`/`finished`, or attach handlers.
- **Unbounded buffering**: collecting a whole download, file or query stream (`readable.toArray()`, `Buffer.concat` of every chunk, `readFile` on files of unknown size) → memory blow-ups on large inputs. Fix: stream to the destination, or cap the bytes read.
- **Chunk boundaries**: `chunk.toString()` per chunk splits multibyte UTF-8 characters, and parsers assuming one line or record per `'data'` event break (default `highWaterMark` rose from 16 to 64 KiB in Node 22). Fix: `setEncoding('utf8')`/`StringDecoder`, `readline` or a framing parser.
