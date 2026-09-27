---
name: Elasticsearch / OpenSearch
description: Elasticsearch and OpenSearch defects from query-string and Painless injection, text/keyword confusion, unmapped nested arrays, deep paging, capped totals, bulk partial failures, refresh semantics, dynamic mappings and lost updates.
category: database
priority: 55
tier: essential
tags:
  - CWE-943
  - CWE-400
  - CWE-362
  - OWASP-A05
activation:
  stack:
    - db.elasticsearch
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
    - json
  files:
    - "**/{elasticsearch,opensearch}/**"
    - "**/*{-mapping,-mappings,_mapping,_mappings}.json"
  content:
    - (?:from\s+|require\(\s*)['"](?:@elastic/elasticsearch|@opensearch-project/opensearch|elasticsearch)['"]
    - \b(?:import|from)\s+(?:elasticsearch|elasticsearch_dsl|elasticsearch8|opensearchpy|opensearch_dsl)\b|github\.com/(?:elastic/go-elasticsearch|olivere/elastic|opensearch-project/opensearch-go)|\bco\.elastic\.clients\b|\b(?:ElasticsearchClient|RestHighLevelClient|ElasticsearchOperations|ElasticsearchRepository|OpenSearchClient|ElasticClient)\b|\bElastic\.Clients\.Elasticsearch\b|\busing\s+Nest\s*;|\b(?:Searchkick|searchkick|Chewy)\b|\bElasticsearch\\Client
    - \b(?:match_phrase|multi_match|query_string|simple_query_string|search_after|track_total_hits|function_score|if_seq_no|retry_on_conflict|max_result_window|point_in_time|update_by_query|delete_by_query)\b|['"]_source['"]|/_(?:search|bulk|doc|update_by_query|delete_by_query|reindex|mapping|msearch|count)\b
    - '\b(?:client|es|esClient|elastic\w*|opensearch\w*|search[Cc]lient)\.(?:search|bulk|msearch|updateByQuery|update_by_query|deleteByQuery|delete_by_query|reindex|scroll|openPointInTime|open_point_in_time)\(|\.indices\.(?:create|put_?[Mm]apping|put_?[Ss]ettings|update_?[Aa]liases|put_?[Ii]ndex_?[Tt]emplate)\(|"mappings"\s*:\s*\{[\s\S]{0,400}?"properties"\s*:'
---
- **Query injection**: user text in `query_string` → queries on any field (`password:*`), leading wildcards, regexes, 400s on bad syntax; values spliced into Painless `source` are injectable. Fix: `simple_query_string` with fixed `fields`, script `params`.
- **text vs keyword**: `term`, sorts or aggs on analyzed `text` fail; `match` on ids or tenant fields matches partial tokens → cross-tenant hits; dynamic `.keyword` ignores values over 256 chars. Fix: `keyword` fields, `term` filters.
- **Object arrays**: arrays of objects not mapped `nested` lose pairing, so `users.name:alice AND users.role:admin` matches Alice-the-viewer plus any admin → wrong hits, permission leaks. Fix: `nested` mapping and `nested` queries.
- **Deep pagination**: `from + size` beyond 10,000, client-chosen `size` or never-cleared scroll contexts → rejected searches, heap exhaustion. Fix: `search_after` with a point in time and unique tiebreaker; capped `size`.
- **Capped totals**: `hits.total` is `{ value, relation }` capped at 10,000 unless `track_total_hits: true`; `terms` aggs return 10 buckets with approximate counts → wrong totals, missing groups. Fix: set the flag, composite aggregations.
- **Bulk partial failures**: `_bulk` answers 200 with `errors: true` and per-item failures; `update_by_query` reports `failures` and version conflicts in the body → silently dropped writes. Fix: inspect items, retry 429s.
- **Near-real-time**: searching right after indexing (before a refresh) → missing documents; `refresh: true` on every write → collapsed indexing throughput. Fix: `refresh: 'wait_for'` only where needed, or `GET` by id.
- **Mappings**: user-controlled keys explode the mapping → rejected documents; the first value fixes a field's type (later floats truncate into `long`); types can't change in place. Fix: explicit mappings, `dynamic: strict`, reindex behind aliases.
- **Lost updates**: read-modify-write via `index` without `if_seq_no`/`if_primary_term`, or `update` without `retry_on_conflict` → overwritten changes, unhandled 409s. Fix: pass those parameters.
