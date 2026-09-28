---
name: Ruby on Rails
description: Rails correctness defects — nil or array params in finders, filters missing new actions, silently dropped params, ignored save results, side effects before commit, swallowed nested rollbacks, skipped validations, uniqueness races, positional enums, eager-loading gaps and default_scope surprises.
category: framework
priority: 66
tier: essential
tags:
  - CWE-639
  - CWE-862
  - CWE-252
  - CWE-362
  - CWE-400
  - OWASP-A01
  - OWASP-A06
  - OWASP-A07
activation:
  stack:
    - framework.rails
    - orm.activerecord
  languages:
    - ruby
    - text
  files:
    - "**/app/**/*.rb"
    - "**/app/views/**"
    - "**/config/routes.rb"
    - "**/db/migrate/*.rb"
  content:
    - \bparams(?:\[|\.(?:require|permit|expect|fetch)\b)
    - \b(?:ApplicationRecord|ApplicationController|ActiveRecord::|ActionController::|ApplicationJob)\b
    - \.(?:find_by|update_columns?|update_all|insert_all|upsert_all|find_each|save|update)\b|\b(?:before_action|after_commit|after_save|default_scope|enum|transaction)\b
  examples:
    - 'user = User.find_by(token: params[:token])'
    - 'class OrdersController < ApplicationController'
    - 'before_action :authenticate_user!, only: [:create]'
---
- **Nil or array params**: `find_by(token: params[:token])` with the param missing queries `IS NULL` (matches tokenless users); an array param becomes `IN (...)` → reset/login bypass. Fix: require a present string.
- **Filter coverage**: `before_action :authenticate_user!/:authorize!, only: [...]` lists that miss newly added actions → unprotected endpoints. Fix: guard by default, `except:` for public actions.
- **Ignored results**: `save`/`update` return `false` and `create` an unsaved record on validation failure; unchecked in jobs, services or callbacks → silent data loss. Fix: bang methods outside form flows.
- **Before-commit effects**: jobs, mail or HTTP calls in `after_save`/`after_create` or inside `transaction` blocks → workers miss the row or act on rolled-back data. Fix: `after_commit`, `enqueue_after_transaction_commit`.
- **Swallowed rollbacks**: `raise ActiveRecord::Rollback` in a nested `transaction` block without `requires_new: true` is caught by the inner block → the outer transaction still commits everything.
- **Skipped validations**: `update_column(s)`, `update_all`, `insert_all`/`upsert_all`, `delete_all` skip validations and callbacks → broken invariants, orphans.
- **Uniqueness races**: `validates uniqueness:`/`find_or_create_by` without a unique index → duplicates; read-modify-write counters lose updates. Fix: unique index, `create_or_find_by`, `with_lock`.
- **Positional enums**: `enum :status, [:draft, :live]` stores array positions → inserting or reordering values remaps existing rows. Fix: explicit hash mapping.
- **Loading**: `.present?`/`.blank?` load whole relations; `.all.each` on big tables; serializers and views touching associations without `includes` → memory blowups, N+1. Fix: `exists?`, `find_each`, `includes`.
- **default_scope**: it leaks into `new`/`create` attributes, and `unscoped` also drops association scoping (`user.posts.unscoped` returns everyone's posts). Fix: named scopes.
- **Dropped params**: `permit(:tag_ids)` or `expect` without `tag_ids: []` (or a nested hash shape) silently drops arrays and hashes → fields never saved, no error.
