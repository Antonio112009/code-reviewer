---
name: Redis / Valkey
description: Redis and Valkey defects such as blocking commands, TTL bugs, read-modify-write races, unsafe locks, ignored MULTI/pipeline errors, cross-slot cluster errors, misused connections and bytes-vs-str replies.
category: database
priority: 56
tier: essential
tags:
  - CWE-362
  - CWE-400
  - CWE-667
activation:
  stack:
    - db.redis
  languages:
    - typescript
    - javascript
    - python
    - go
    - java
    - kotlin
    - scala
    - csharp
    - ruby
    - php
    - rust
    - elixir
  content:
    - (?:from\s+|require\(\s*)['"](?:redis|ioredis|@redis/client|@upstash/redis|iovalkey|@valkey/valkey-glide|redlock)['"]
    - \b(?:import|from)\s+(?:redis|aioredis|valkey|coredis)\b|github\.com/(?:redis/go-redis|go-redis/redis|gomodule/redigo|valkey-io/valkey-go|redis/rueidis)|\bredis\.Nil\b|\bStackExchange\.Redis\b|\bIConnectionMultiplexer\b|\b(?:Jedis\w*|Redisson\w*|RedisTemplate|StringRedisTemplate|LettuceConnectionFactory)\b|\bio\.lettuce\b|\bRedis\.new\b|\bPredis\\|\bnew\s+Redis\s*\(|\bRedix\b|\bredis::(?:Commands|Client|AsyncCommands|cmd|pipe)\b|\bredis\.call\(
    - \.(?:set[Ee]x|p[Ss]et[Ee]x|set[Nn][Xx]|h[Ss]et|h[Gg]et[Aa]ll|h[Ii]ncr[Bb]y|p[Ee]xpire(?:[Aa]t)?|[Ee]xpire[Aa]t|z[Aa]dd|z[Rr]ange\w*|[lr][Pp]ush|l[Rr]ange|b[lr](?:pop|Pop)|s[Aa]dd|s[Mm]embers|x[Aa]dd|x[Rr]ead[Gg]roup|x[Aa]ck|incr|incr[Bb]y|eval[Ss]ha|unlink|scan_iter)\(|\.expire\([^,()\n]{1,80},\s*\d|\.(?:SetNX|SetEx|SetArgs|HSet|HGetAll|HIncrBy|Expire|ExpireAt|ZAdd|LPush|RPush|BLPop|BRPop|XAdd|XReadGroup|XAck|Incr|IncrBy|Eval|EvalSha|Pipelined|TxPipelined|Watch)\(ctx\b|\b(?:String(?:Set|Get|Increment)|Key(?:Expire|Delete)|Hash(?:Set|GetAll)|Lock(?:Take|Release))Async\(|\bopsFor(?:Value|Hash|List|Set|ZSet)\(\)
  examples:
    - 'import Redis from "ioredis";'
    - 'import redis'
    - 'await client.setEx(sessionKey, 3600, JSON.stringify(session));'
---
- **Blocking commands**: `KEYS`, `HGETALL`/`SMEMBERS`/`LRANGE 0 -1` or `DEL` on big keys in request paths stall the single-threaded server; in Cluster, `KEYS`/`SCAN` see one node → missed keys. Fix: `SCAN` family, `UNLINK`.
- **TTL bugs**: `SET`+`EXPIRE` as two calls, or `EXPIRE` only after the first `INCR`, leave immortal keys after a crash → permanent lockouts; plain `SET` drops an existing TTL. Fix: `SET` with `EX`, `EXPIRE NX`, `KEEPTTL`.
- **Read-modify-write**: `GET` → compute → `SET` on counters, quotas or JSON blobs loses concurrent updates; `WATCH` on a shared client connection guards nothing. Fix: `INCRBY`/`HINCRBY`, Lua, `WATCH` on a dedicated connection with retries.
- **Unsafe locks**: `SETNX` without expiry, plain `DEL` release (frees another holder's lock), work outliving the TTL → double execution. Fix: `SET key token NX PX`, compare-and-delete via Lua or `DELEX … IFEQ` (8.4+), fencing tokens.
- **Ignored reply errors**: `MULTI`/`EXEC` never rolls back (one failing command doesn't stop the rest); ioredis `exec()` resolves `[err, result]` pairs for multi and pipelines → failed writes pass silently. Fix: check every reply.
- **Cluster slots**: multi-key commands, `MULTI` or Lua over keys in different hash slots, or Lua keys not passed via `KEYS` → `CROSSSLOT` errors, often only in production clusters. Fix: `{tag}` hash tags, declare every key.
- **Connection misuse**: node-redis clients lacking an `'error'` listener, or `BLPOP`, `XREAD BLOCK` or `SUBSCRIBE` on the shared client → process crash on disconnect, stalled or failing commands. Fix: listeners, `duplicate()` connections.
- **Python bytes**: redis-py returns `bytes` unless `decode_responses=True` → `b'1' == '1'` is false and f-string keys become `"b'…'"` → silent cache misses, failed checks. Fix: `decode_responses=True`.
