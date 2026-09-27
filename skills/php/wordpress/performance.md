---
name: Queries, options and cron
description: WordPress performance and correctness traps — unbounded WP_Query, get_posts() defaults (5 posts, filters suppressed), meta_query scans, option autoloading (6.6 rules), transients, duplicate cron events and switch_to_blog without restore.
priority: 60
tags: [CWE-400, CWE-1050]
activation:
  content:
    - '\bnew\s+WP_Query\s*\(|\bget_posts\s*\(|\b(?:posts_per_page|numberposts|nopaging|meta_query|suppress_filters)\b'
    - '\b(?:add|update)_option\s*\(|\bset_(?:site_)?transient\s*\('
    - '\bwp_schedule_(?:single_)?event\s*\(|\bswitch_to_blog\s*\('
sources:
  - https://developer.wordpress.org/reference/functions/get_posts/
  - https://developer.wordpress.org/reference/classes/wp_query/
  - https://make.wordpress.org/core/2024/06/18/options-api-disabling-autoload-for-large-options/
  - https://developer.wordpress.org/plugins/cron/scheduling-wp-cron-events/
---
- **Unbounded queries**: `posts_per_page => -1`, `nopaging => true` or `numberposts => -1` load every post plus meta and term caches → memory exhaustion and timeouts on large sites. Fix: paginate or batch.
- **get_posts() defaults**: it returns 5 posts and sets `suppress_filters => true` → silently truncated lists, and filters from multilingual or access-control plugins are skipped. Fix: set `numberposts` and `suppress_filters` explicitly.
- **Meta queries**: `meta_query`, `orderby => meta_value` and `LIKE '%…%'` on the unindexed `meta_value` column scan the whole table. Fix: taxonomies, custom tables or indexed lookup keys.
- **Autoload**: large or rarely used options load on every request; since 6.6 the default `$autoload` is `null` and options over 150 KB are not autoloaded unless forced → pass `false`/`true` deliberately. Transients without expiration become autoloaded options when no object cache exists.
- **Cron duplicates**: `wp_schedule_event()` on every `init` without a `wp_next_scheduled()` check queues duplicate events; WP-Cron only runs on page loads. Fix: schedule on activation, unschedule on deactivation.
- **switch_to_blog()**: without a matching `restore_current_blog()` every later query, option and URL uses the wrong site.
