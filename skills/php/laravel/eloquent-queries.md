---
name: Eloquent and query builder reads
description: Query bugs — ungrouped orWhere escaping tenant filters, user-chosen column names, raw expressions, scope bypass, N+1 loading, chunk() while updating and loading whole tables into memory.
priority: 68
tags: [CWE-89, CWE-639, CWE-400]
activation:
  content:
    - '->(?:orWhere\w*|whereRaw|orderByRaw|selectRaw|havingRaw|groupByRaw|orderBy|pluck)\s*\('
    - '\bDB::(?:raw|select|table|statement)\s*\(|->(?:withoutGlobalScopes?|withTrashed)\s*\('
    - '->(?:chunk|chunkById|cursor|lazy|each)\s*\(|::all\s*\(\s*\)|->with\s*\('
  examples:
    - '$users = User::where(''team_id'', $teamId)->orWhere(''is_public'', true)->get();'
    - '$rows = DB::table(''users'')->where(''active'', true)->get();'
    - 'User::with(''posts'')->chunkById(200, function ($users) { /* ... */ });'
sources:
  - https://laravel.com/docs/13.x/queries
  - https://laravel.com/docs/13.x/eloquent#chunking-results
  - https://laravel.com/docs/13.x/eloquent-relationships#eager-loading
---
- **Ungrouped orWhere**: `->where('team_id', $t)->orWhere('is_public', true)` yields `team_id = ? OR is_public = 1` → other tenants' rows; global scopes are ANDed after it. Fix: group with `where(fn ($q) => …)`.
- **User-chosen columns**: request values used as column names in `orderBy`, `where`, `pluck`, `select` cannot be bound → injection, or sorting by hidden columns such as `password`. Fix: allowlist.
- **Raw expressions**: `whereRaw("email = '$email'")`, `DB::raw()`, `selectRaw`, `orderByRaw` with interpolation → SQL injection. Fix: `?` bindings in the second argument.
- **Scope bypass**: `DB::table()`, `withoutGlobalScopes()`, `withTrashed()` or raw SQL skip tenant and soft-delete scopes → foreign or deleted rows returned.
- **N+1**: relations touched in loops, Blade, API Resources or `$appends` accessors without `with()` → one query per row. Fix: eager load; `Model::preventLazyLoading()` outside production.
- **chunk() while updating**: `chunk()` over rows filtered by a column the callback changes skips rows. Fix: `chunkById()`/`lazyById()`, and group your own `orWhere` because they add a `where`.
- **Loading everything**: `Model::all()`/`get()` then filtering in PHP, `$user->posts->count()` (loads the relation), `cursor()` (MySQL still buffers the result) → memory exhaustion. Fix: aggregate in SQL, `lazyById()`.
