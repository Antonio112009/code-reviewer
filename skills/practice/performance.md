---
name: Performance
description: Scalability defects in application code — per-item remote calls, serial awaits, quadratic work, unbounded loads and caches, per-call client setup, event-loop blocking, cache-key gaps, stampedes and missing timeouts.
category: practice
priority: 50
tier: essential
tags:
  - CWE-400
  - CWE-770
  - CWE-407
  - CWE-1050
activation:
  languages:
    - typescript
    - javascript
    - python
    - php
    - java
    - kotlin
    - csharp
    - go
    - rust
    - c
    - cpp
    - ruby
    - swift
    - scala
    - dart
    - elixir
    - objective-c
    - vue
    - svelte
    - groovy
  content:
    - (?:\b(?:for|foreach|while)\s*\(|\bfor\s+\w+(?:\s*,\s*\w+)?\s+in\b|\bfor\s+[\w, ]{1,40}:?=\s*range\b|\.(?:forEach|each|map)\s*[({])(?:[^\n]{0,160}\n){0,4}?[^\n]{0,160}?(?:\bawait\b|\.(?:query|execute|findOne|findUnique|findFirst|findById|find_by|save|request|invoke)\(|\bobjects\.get\(|\b(?:fetch|axios|requests|httpx|urlopen)\b|\bhttp\.\w)|\bfor\s+await\b
    - \.(?:map|filter|forEach|some|every|reduce|flatMap)\([^\n]{0,160}?\.(?:includes|indexOf|find|findIndex|filter|some)\(|\breduce\([^\n]{0,80}?\.\.\.(?:acc|prev|memo|result|a)\b
    - \.(?:findAll|findMany|find_all|fetchAll|fetchall|getAll|readAllBytes|readAllLines|ReadToEnd(?:Async)?)\(\s*\)|\.objects\.all\(\)|\bio(?:util)?\.ReadAll\(|\bFile\.ReadAll(?:Text|Bytes|Lines)\(
    - \b(?:readFileSync|writeFileSync|execSync|spawnSync|execFileSync|hashSync|compareSync|pbkdf2Sync|scryptSync|inflateSync|gunzipSync|deflateSync)\b|JSON\.parse\(JSON\.stringify\(
    - \bnew (?:HttpClient|PrismaClient|Pool|Redis|S3Client|\w+Client)\(|\bboto3\.(?:client|resource)\(|\bhttpx\.(?:Async)?Client\(|\bredis\.(?:Strict)?Redis\(|\bsql\.Open\(|\bcreate(?:Pool|Client|Connection)\(|\bnew RegExp\(|\bre\.compile\(|\bPattern\.compile\(|\bregexp\.MustCompile\(
    - "@(?:lru_cache|cache|cached|Cacheable|memoize)\\b|\\bfunctools\\.(?:lru_cache|cache)\\b|\\b(?:memoize|memoizee|IMemoryCache|MemoryCache|Caffeine|CacheBuilder|NodeCache|LRUCache|singleflight)\\b|\\b(?:cache|memo|_cache|CACHE)\\w*\\s*(?::[^=\\n]{1,60})?=\\s*(?:new (?:Map|WeakMap)\\(|\\{\\}|dict\\(\\)|make\\(map)|\\.labels\\(|\\bWithLabelValues\\("
    - \b(?:requests|httpx)\.(?:get|post|put|patch|delete|head|request)\(|\bhttp\.(?:Get|Post|Head|DefaultClient)\b|&http\.Client\{|\burlopen\(
  examples:
    - 'for (const id of ids) { await db.query("select * from users where id = ?", [id]); }'
    - 'const missing = items.filter(item => selected.includes(item.id));'
    - 'const allUsers = await User.findAll();'
    - 'const data = fs.readFileSync(path, "utf8");'
    - 'const client = new PrismaClient();'
    - 'const cache = new Map();'
    - 'const response = requests.get(url);'
---
- **Per-item remote calls**: queries, HTTP/RPC, cache or storage calls issued once per item inside loops, `map` or serializers → latency and cost grow with data, rate limits hit. Fix: batch APIs, `IN` queries, DataLoader.
- **Serial awaits**: independent awaits run one after another → latency is the sum, not the max. Fix: bounded `Promise.all`/`gather`/errgroup, or one batch call.
- **Quadratic work**: `includes`/`indexOf`/`find`/`in list` inside loops or `filter`, nested loops joining collections, `reduce` spreading its accumulator (`{...acc}`), string `+=` in loops → O(n²) on real data. Fix: build a Set/Map once.
- **Unbounded loads**: whole tables (`findAll()`, `.all()`), files, uploads or response bodies read into memory, or filtered in code instead of the query → OOM and timeouts as data grows. Fix: filter in SQL, paginate, stream.
- **Per-call setup**: clients, pools or ORM instances (`new PrismaClient()`, `HttpClient`, `boto3.client`), regex compilation or config/template loading inside handlers or loops → connection exhaustion, CPU churn. Fix: create once, reuse.
- **Event-loop blocking**: `readFileSync`, `execSync`, `bcrypt.hashSync`, `zlib.*Sync`, `pbkdf2Sync`, huge `JSON.parse`/`stringify` or CPU loops on Node request paths → every concurrent request stalls. Fix: async APIs, worker threads, streaming.
- **Unbounded growth**: module-level Map/dict caches or `lru_cache(maxsize=None)` keyed by user input; per-request listeners or timers; metric labels with user ids or raw URLs → memory leak, metrics blow-up. Fix: size/TTL bounds, cleanup, bounded labels.
- **Cache misuse**: keys missing user, tenant, locale or permission inputs, or hot keys expiring together without single-flight or negative caching → other users' data served, backend stampedes. Fix: key every input, in-flight dedupe, TTL jitter.
- **No timeouts**: outbound HTTP, RPC or DB calls and pool acquisition without timeouts (`requests` and Go `http.DefaultClient` have none) → one stalled dependency pins every worker. Fix: connect/read timeouts, propagated deadlines.
