---
name: Capabilities, nonces and REST permissions
description: WordPress authorization traps — nonces used as authorization, is_admin() as a permission check, nopriv AJAX and admin_init handlers, ignored nonce results, REST routes without real permission_callback checks, meta exposed via show_in_rest, and role or generic capability checks.
priority: 76
tags: [CWE-862, CWE-863, CWE-352, OWASP-A01]
activation:
  content:
    - '\b(?:wp_ajax|wp_ajax_nopriv|admin_post|admin_post_nopriv)_\w+|\badmin_init\b|\bis_admin\s*\('
    - '\bcurrent_user_can\s*\(|\bcheck_(?:ajax|admin)_referer\s*\(|\bwp_verify_nonce\s*\('
    - '\bregister_rest_route\s*\(|\bpermission_callback\b|\bregister_(?:post_|term_|user_)?meta\s*\(|\bshow_in_rest\b'
  examples:
    - 'add_action(''wp_ajax_nopriv_submit_form'', ''handle_submit'');'
    - 'if (!current_user_can(''edit_post'', $post_id)) {'
    - 'register_rest_route(''myplugin/v1'', ''/items'', [''permission_callback'' => ''__return_true'']);'
sources:
  - https://developer.wordpress.org/apis/security/nonces/
  - https://developer.wordpress.org/reference/functions/is_admin/
  - https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/
  - https://developer.wordpress.org/reference/functions/register_meta/
---
- **Nonce is not authorization**: `check_admin_referer()`/`check_ajax_referer()`/`wp_verify_nonce()` only stop CSRF, and logged-out visitors share nonces → every state-changing handler also needs `current_user_can()`.
- **is_admin()**: true for any request to `admin-ajax.php` or `admin-post.php`, including unauthenticated ones → it checks the screen, not the user.
- **Public handlers**: `wp_ajax_nopriv_*` and `admin_post_nopriv_*` callbacks are reachable by anyone, and `admin_init` also fires for unauthenticated AJAX requests → privileged code there runs for visitors.
- **Ignored nonce results**: `wp_verify_nonce()` returns `false`/1/2 and never stops execution; `check_ajax_referer($action, $arg, false)` returns instead of dying → unchecked results mean no CSRF protection. Always pass a specific action.
- **REST permission_callback**: a missing callback (only a notice since 5.5) or `__return_true` on write routes leaves them public; `is_user_logged_in()` lets any subscriber act on others' data. Fix: object-level capability checks.
- **Meta in REST**: `register_post_meta()` with `show_in_rest` but no `auth_callback`, or exposing private keys → meta readable and writable through the REST API.
- **Wrong capability**: `current_user_can('administrator')` checks a role name, and generic `edit_posts` instead of `edit_post` with the post ID lets contributors change other users' posts.
