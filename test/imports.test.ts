import { beforeAll, describe, expect, it } from 'vitest';
import {
  expandGroups,
  extractImports,
  initImportLexer,
  joinInside,
  parseJsonc,
  resolveImports,
} from '../src/chunking/imports';

const specs = (file: string, content: string) => extractImports(file, content).map((s) => s.specifier);

beforeAll(async () => {
  expect(await initImportLexer()).toBe(true);
});

describe('extractImports', () => {
  it('lexes JS/TS modules: static, type-only, re-exports, dynamic, require and test mocks', () => {
    const code = [
      "import type { A } from './a';",
      'import x, { y as z } from "../b.js";',
      "export * from './c';",
      "export { d } from './d';",
      "const e = await import('./e');",
      "const f = require('./f');",
      "import g = require('./g');",
      "vi.mock('./h');",
      'const tpl = import(`./locales/\x24{lang}.js`);',
      'const meta = import.meta.url;',
    ].join('\n');
    expect(specs('src/x.ts', code)).toEqual(['./a', '../b.js', './c', './d', './e', './g', './f', './h']);
  });

  it('falls back to regular expressions for JSX/TSX', () => {
    const code = [
      'import React, {',
      '  useState,',
      '  useEffect,',
      "} from 'react';",
      "import './styles.css';",
      "import type { Props } from '@/types';",
      "export { Button } from './Button';",
      'export const App = () => <div className="app">{useState(0)}</div>;',
      "const Lazy = lazy(() => import('./Lazy'));",
    ].join('\n');
    expect(specs('src/App.tsx', code)).toEqual(['react', './styles.css', '@/types', './Button', './Lazy']);
  });

  it('falls back to regular expressions when the lexer rejects a .js file (JSX in .js)', () => {
    const code = "import a from './a';\nexport default () => <div>{a}</div>;\n";
    expect(specs('src/view.js', code)).toEqual(['./a']);
  });

  it('extracts Python imports (absolute, relative, parenthesised, aliased)', () => {
    const code = [
      'import os, app.models as m',
      'from . import utils',
      'from ..core.db import (',
      '    Session,',
      '    engine as eng,',
      ')',
      'from pkg.sub import thing  # comment',
      '    import late.module',
    ].join('\n');
    const out = extractImports('app/views.py', code);
    expect(out).toEqual([
      { scheme: 'python', specifier: '.', names: ['utils'] },
      { scheme: 'python', specifier: '..core.db', names: ['Session', 'engine'] },
      { scheme: 'python', specifier: 'pkg.sub', names: ['thing'] },
      { scheme: 'python', specifier: 'os' },
      { scheme: 'python', specifier: 'app.models' },
      { scheme: 'python', specifier: 'late.module' },
    ]);
  });

  it('extracts Go import blocks and single imports', () => {
    const code = [
      'package main',
      'import "fmt"',
      'import (',
      '  "net/http"',
      '  db "example.com/app/internal/db"',
      '  _ "example.com/app/internal/migrations" // side effects',
      ')',
    ].join('\n');
    expect(specs('cmd/main.go', code)).toEqual([
      'fmt',
      'net/http',
      'example.com/app/internal/db',
      'example.com/app/internal/migrations',
    ]);
  });

  it('extracts JVM imports (Java, Kotlin, Scala) with wildcards', () => {
    const java = 'package a.b;\nimport a.b.c.Foo;\nimport static a.b.Util.max;\nimport a.b.d.*;\n';
    expect(extractImports('src/X.java', java)).toEqual([
      { scheme: 'jvm', specifier: 'a.b.c.Foo' },
      { scheme: 'jvm', specifier: 'a.b.Util.max' },
      { scheme: 'jvm', specifier: 'a.b.d', wildcard: true },
    ]);
    expect(specs('src/X.kt', 'import a.b.Foo as Bar\nimport a.b.baz\n')).toEqual(['a.b.Foo', 'a.b.baz']);
    expect(extractImports('src/X.scala', 'import a.b.{Foo, Bar => B, _}\n')).toEqual([
      { scheme: 'jvm', specifier: 'a.b.Foo' },
      { scheme: 'jvm', specifier: 'a.b.Bar' },
      { scheme: 'jvm', specifier: 'a.b', wildcard: true },
    ]);
  });

  it('extracts C# usings as namespace imports', () => {
    const code =
      'using System;\nglobal using App.Models;\nusing static App.Util.Math;\nusing var x = Open();\n';
    expect(extractImports('Api/Controller.cs', code)).toEqual([
      { scheme: 'csharp', specifier: 'System', wildcard: true },
      { scheme: 'csharp', specifier: 'App.Models', wildcard: true },
      { scheme: 'csharp', specifier: 'App.Util.Math' },
    ]);
  });

  it('extracts PHP use statements (grouped) and includes', () => {
    const code = [
      '<?php',
      'namespace App\\Http;',
      'use App\\Models\\User;',
      'use App\\Services\\{Mailer, Billing\\Invoice as Inv};',
      'use function App\\helpers\\format;',
      'use HasFactory;',
      "require_once __DIR__ . '/bootstrap.php';",
      "include 'config.php';",
    ].join('\n');
    expect(extractImports('src/Http/Ctl.php', code)).toEqual([
      { scheme: 'php', specifier: 'App\\Models\\User' },
      { scheme: 'php', specifier: 'App\\Services\\Mailer' },
      { scheme: 'php', specifier: 'App\\Services\\Billing\\Invoice' },
      { scheme: 'php-file', specifier: './bootstrap.php' },
      { scheme: 'php-file', specifier: 'config.php' },
    ]);
  });

  it('extracts Ruby, Rust, C and Dart imports; Swift has none', () => {
    expect(extractImports('lib/a.rb', "require_relative '../b'\nrequire 'json'\n")).toEqual([
      { scheme: 'ruby-relative', specifier: '../b' },
      { scheme: 'ruby', specifier: 'json' },
    ]);
    const rust =
      'mod parser;\npub(crate) mod lexer;\nuse crate::ast::{Node, visit::{Visitor, walk}, self};\nuse super::util as u;\nmod inline { }\n';
    expect(specs('src/lib.rs', rust)).toEqual([
      'parser',
      'lexer',
      'crate::ast::Node',
      'crate::ast::visit::Visitor',
      'crate::ast::visit::walk',
      'crate::ast',
      'super::util',
    ]);
    expect(extractImports('src/a.c', '#include "a.h"\n#include <stdio.h>\n# include "../inc/b.h"\n')).toEqual(
      [
        { scheme: 'c', specifier: 'a.h', system: false },
        { scheme: 'c', specifier: 'stdio.h', system: true },
        { scheme: 'c', specifier: '../inc/b.h', system: false },
      ],
    );
    expect(
      specs('lib/a.dart', "import 'package:app/src/b.dart';\nimport 'dart:io';\npart 'a.g.dart';\n"),
    ).toEqual(['package:app/src/b.dart', 'dart:io', 'a.g.dart']);
    expect(extractImports('Sources/A.swift', 'import Foundation\n')).toEqual([]);
    expect(extractImports('README.md', "import x from './y'")).toEqual([]);
  });

  it('stays linear on adversarial input (untrusted PRs)', () => {
    const n = 200_000;
    const inputs: Array<[string, string]> = [
      ['a.py', `from ${'.'.repeat(n)} x`],
      ['a.php', `require${' '.repeat(n)}x`],
      ['a.go', 'import (\n'.repeat(n / 9)],
      ['a.rs', 'use a::b\n'.repeat(n / 9)],
      ['a.php', 'use A\\B\n'.repeat(n / 8)],
      ['a.tsx', `import${' '.repeat(n)}x`],
      ['a.cs', `using ${'a'.repeat(n)}`],
    ];
    for (const [file, content] of inputs) {
      const start = performance.now();
      extractImports(file, content);
      expect(performance.now() - start).toBeLessThan(250);
    }
  });

  it('expands grouped paths with a bound on the output', () => {
    expect(expandGroups('a::{b,c::{d,e},self}', '::')).toEqual(['a::b', 'a::c::d', 'a::c::e', 'a']);
    expect(
      expandGroups(`x::{${Array.from({ length: 200 }, (_, i) => `m${i}`).join(',')}}`, '::'),
    ).toHaveLength(64);
  });
});

describe('parseJsonc / joinInside', () => {
  it('parses comments and trailing commas without touching strings', () => {
    const text = `﻿{
      // line comment
      "compilerOptions": {
        "baseUrl": "./src", /* block */
        "paths": { "@/*": ["./*",], "url": ["http://x//y"], },
      },
    }`;
    expect(parseJsonc(text)).toEqual({
      compilerOptions: { baseUrl: './src', paths: { '@/*': ['./*'], url: ['http://x//y'] } },
    });
    expect(parseJsonc('{ "a": 1, // trailing\n }')).toEqual({ a: 1 });
    expect(parseJsonc('{ nope')).toBeUndefined();
  });

  it('refuses paths that leave the root', () => {
    expect(joinInside('src/a', '../b')).toBe('src/b');
    expect(joinInside('src', '../../etc/passwd')).toBeUndefined();
    expect(joinInside('.', '/etc/passwd')).toBeUndefined();
    expect(joinInside('.', '.')).toBe('.');
  });
});

async function resolve(files: Record<string, string>, others: string[] = []): Promise<Map<string, string[]>> {
  const all = [...Object.keys(files), ...others];
  return resolveImports({
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    allFiles: all,
    readFile: async (p) => files[p],
  });
}

describe('resolveImports', () => {
  it('resolves relative JS/TS specifiers with extension and index probing', async () => {
    const out = await resolve(
      {
        'src/app.ts': [
          "import { a } from './a.js';",
          "import b from './lib';",
          "import c from '../shared/c';",
          "import d from '.';",
          "import e from 'react';",
          "import f from '../../../etc/passwd';",
          "import g from 'node:fs';",
        ].join('\n'),
      },
      ['src/a.ts', 'src/lib/index.tsx', 'shared/c.mjs', 'src/index.ts', 'etc/passwd'],
    );
    expect(out.get('src/app.ts')).toEqual(['shared/c.mjs', 'src/a.ts', 'src/index.ts', 'src/lib/index.tsx']);
  });

  it('resolves tsconfig paths and baseUrl through extends (JSONC)', async () => {
    const files = {
      'tsconfig.base.json':
        '{ /* shared */ "compilerOptions": { "paths": { "@lib/*": ["libs/*/src"], "~config": ["config/index.ts"], }, }, }',
      'apps/web/tsconfig.json':
        '{ "extends": "../../tsconfig.base", "compilerOptions": { "baseUrl": "src" } }',
      'apps/web/src/main.ts': [
        "import { ui } from '@lib/ui';",
        "import cfg from '~config';",
        "import { Button } from 'components/Button';",
        "import missing from '@lib/nope';",
      ].join('\n'),
    };
    const out = await resolve(files, [
      'libs/ui/src/index.ts',
      'config/index.ts',
      'apps/web/src/components/Button.tsx',
    ]);
    // with baseUrl set, paths resolve against it: `libs/*` lives outside apps/web/src → only baseUrl hits
    expect(out.get('apps/web/src/main.ts')).toEqual(['apps/web/src/components/Button.tsx']);

    const noBase = await resolve(
      {
        ...files,
        'apps/web/tsconfig.json': '{ "extends": ["../../tsconfig.base.json"] }',
      },
      ['libs/ui/src/index.ts', 'config/index.ts', 'apps/web/src/components/Button.tsx'],
    );
    // without baseUrl, paths are relative to the config that declared them (the repo root here)
    expect(noBase.get('apps/web/src/main.ts')).toEqual(['config/index.ts', 'libs/ui/src/index.ts']);
  });

  it('follows solution-style tsconfig references and the configDir template', async () => {
    const out = await resolve(
      {
        'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
        'tsconfig.app.json': '{ "compilerOptions": { "paths": { "@/*": ["\x24{configDir}/src/*"] } } }',
        'src/a.ts': "import b from '@/b';",
      },
      ['src/b.ts'],
    );
    expect(out.get('src/a.ts')).toEqual(['src/b.ts']);
  });

  it('resolves workspace packages by package.json name, preferring sources over build output', async () => {
    const out = await resolve(
      {
        'packages/utils/package.json': JSON.stringify({ name: '@acme/utils', main: 'dist/index.js' }),
        'packages/api/package.json': JSON.stringify({
          name: '@acme/api',
          exports: {
            '.': { types: './dist/index.d.ts', import: './dist/index.js' },
            './client': './src/client.ts',
          },
        }),
        'apps/web/main.ts':
          "import { u } from '@acme/utils';\nimport { c } from '@acme/api/client';\nimport z from 'zod';",
      },
      ['packages/utils/src/index.ts', 'packages/api/src/client.ts', 'packages/api/src/index.ts'],
    );
    expect(out.get('apps/web/main.ts')).toEqual([
      'packages/api/src/client.ts',
      'packages/utils/src/index.ts',
    ]);
  });

  it('resolves Python relative and absolute imports against source roots', async () => {
    const out = await resolve(
      {
        'src/myapp/views.py': [
          'from . import forms',
          'from .models import User',
          'from ..shared import util',
          'from myapp.services import billing',
          'import myapp.db',
          'import os',
        ].join('\n'),
      },
      [
        'src/myapp/__init__.py',
        'src/myapp/forms.py',
        'src/myapp/models/__init__.py',
        'src/shared/util.py',
        'src/myapp/services/__init__.py',
        'src/myapp/services/billing.py',
        'src/myapp/db.py',
        'tests/fixtures/myapp/db.py',
      ],
    );
    expect(out.get('src/myapp/views.py')).toEqual([
      'src/myapp/__init__.py',
      'src/myapp/db.py',
      'src/myapp/forms.py',
      'src/myapp/models/__init__.py',
      'src/myapp/services/__init__.py',
      'src/myapp/services/billing.py',
      'src/shared/util.py',
    ]);
  });

  it('resolves Go imports through go.mod module paths (package = directory, tests excluded)', async () => {
    const out = await resolve(
      {
        'go.mod': 'module example.com/app\n\ngo 1.23\n',
        'cmd/main.go':
          'package main\nimport (\n  "fmt"\n  "example.com/app/internal/db"\n  "github.com/x/y"\n)\n',
      },
      ['internal/db/db.go', 'internal/db/tx.go', 'internal/db/db_test.go'],
    );
    expect(out.get('cmd/main.go')).toEqual(['internal/db/db.go', 'internal/db/tx.go']);
  });

  it('resolves JVM imports by path suffix, wildcards and same-package classes by usage', async () => {
    const out = await resolve(
      {
        'src/main/java/com/acme/web/Controller.java': [
          'package com.acme.web;',
          'import com.acme.model.User;',
          'import static com.acme.util.Strings.trim;',
          'import com.acme.service.*;',
          'class Controller { UserService svc; Helper h; User u; }',
        ].join('\n'),
      },
      [
        'src/main/java/com/acme/model/User.java',
        'src/main/java/com/acme/util/Strings.java',
        'src/main/java/com/acme/service/UserService.java',
        'src/main/java/com/acme/service/OrderService.java',
        'src/main/java/com/acme/web/Helper.java',
        'src/main/java/com/acme/web/Unused.java',
      ],
    );
    expect(out.get('src/main/java/com/acme/web/Controller.java')).toEqual([
      'src/main/java/com/acme/model/User.java',
      'src/main/java/com/acme/service/UserService.java',
      'src/main/java/com/acme/util/Strings.java',
      'src/main/java/com/acme/web/Helper.java',
    ]);
  });

  it('resolves C# namespaces to the classes the file uses (weak, folder-based)', async () => {
    const out = await resolve(
      {
        'Api/Controllers/UserController.cs':
          'using Acme.Api.Services;\nnamespace Acme.Api.Controllers;\nclass UserController { UserService s; }',
      },
      ['Api/Services/UserService.cs', 'Api/Services/OrderService.cs'],
    );
    expect(out.get('Api/Controllers/UserController.cs')).toEqual(['Api/Services/UserService.cs']);
  });

  it('resolves PHP classes through composer PSR-4 and relative includes', async () => {
    const out = await resolve(
      {
        'composer.json': JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'src/' } } }),
        'src/Http/Controller.php':
          "<?php\nuse App\\Models\\User;\nuse Vendor\\Lib\\Thing;\nrequire_once __DIR__ . '/helpers.php';\n",
      },
      ['src/Models/User.php', 'src/Http/helpers.php'],
    );
    expect(out.get('src/Http/Controller.php')).toEqual(['src/Http/helpers.php', 'src/Models/User.php']);
  });

  it('resolves Ruby, Rust, C and Dart imports', async () => {
    const out = await resolve(
      {
        'lib/app/a.rb': "require_relative 'b'\nrequire 'app/c'\n",
        'Cargo.toml': '[package]\nname = "my-crate"\n',
        'src/lib.rs': 'mod parser;\npub mod ast;\nuse crate::ast::node::Node;\n',
        'src/ast/mod.rs': 'use super::parser::parse;\nuse self::node::Kind;\n',
        'tests/it.rs': 'use my_crate::parser::parse;\n',
        'native/a.c': '#include "a.h"\n#include <stdio.h>\n#include "common/util.h"\n',
        'pubspec.yaml': 'name: app\n',
        'lib/src/w.dart': "import 'package:app/src/model.dart';\nimport 'util.dart';\n",
      },
      [
        'lib/app/b.rb',
        'lib/app/c.rb',
        'src/parser.rs',
        'src/ast/node.rs',
        'native/a.h',
        'include/common/util.h',
        'lib/src/model.dart',
        'lib/src/util.dart',
      ],
    );
    expect(out.get('lib/app/a.rb')).toEqual(['lib/app/b.rb', 'lib/app/c.rb']);
    expect(out.get('src/lib.rs')).toEqual(['src/ast/mod.rs', 'src/ast/node.rs', 'src/parser.rs']);
    expect(out.get('src/ast/mod.rs')).toEqual(['src/ast/node.rs', 'src/parser.rs']);
    expect(out.get('tests/it.rs')).toEqual(['src/parser.rs']);
    expect(out.get('native/a.c')).toEqual(['include/common/util.h', 'native/a.h']);
    expect(out.get('lib/src/w.dart')).toEqual(['lib/src/model.dart', 'lib/src/util.dart']);
  });

  it('works without readFile (path-only resolution) and never throws on odd input', async () => {
    const out = await resolveImports({
      files: [
        { path: 'a.ts', content: "import x from './b';\nimport y from '\u0000';" },
        { path: 'weird.py', content: 'from ........ import x\nimport' },
      ],
      allFiles: ['a.ts', 'b.ts', 'weird.py'],
    });
    expect(out.get('a.ts')).toEqual(['b.ts']);
    expect(out.get('weird.py')).toEqual([]);
  });
});
