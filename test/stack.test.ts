import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { analyze, normalizeImage } from '../src/context/stack/detect';
import {
  ACTIVE_SCORE,
  type DetectedStack,
  detectStack,
  isTechId,
  ruleCount,
  techsForFile,
  techVersionsForFiles,
  WEAK_SCORE,
} from '../src/context/stack/index';
import { normalizeDep, parseManifest } from '../src/context/stack/manifests';
import { classify, pickCandidates } from '../src/context/stack/read';
import { type FileKind, RULES, TEXT_RULES, VERSION_DEPS, VERSION_IMAGES } from '../src/context/stack/rules';
import {
  depSpecVersion,
  imageTag,
  imageTagVersion,
  javaVersion,
  nodeVersion,
  pythonVersion,
  specVersion,
  substituteArgs,
  tfmVersion,
} from '../src/context/stack/versions';
import { GitRepo } from '../src/git/repo';
import { makeRepo } from './helpers';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stack');
const fixture = (name: string) => detectStack({ root: path.join(FIXTURES, name) });

const score = (p: DetectedStack, id: string) => p.techs.find((t) => t.id === id)?.score ?? 0;
const version = (p: DetectedStack, id: string) => p.techs.find((t) => t.id === id)?.version;
const pkg = (p: DetectedStack, dir: string) => p.packages.find((x) => x.dir === dir);

const temps: string[] = [];
function tempDir(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cr-stack-'));
  temps.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

describe('rule table', () => {
  it('has 150+ signals over canonical tech ids only', () => {
    expect(ruleCount()).toBeGreaterThanOrEqual(150);
    for (const r of RULES) {
      expect(isTechId(r.id)).toBe(true);
      for (const i of r.implies ?? []) expect(isTechId(i)).toBe(true);
    }
    for (const t of TEXT_RULES) {
      const ids = typeof t.map === 'string' ? [t.map] : Object.values(t.map);
      for (const id of ids) expect(isTechId(id)).toBe(true);
    }
  });

  it('classifies only allow-listed files and never plain .env', () => {
    expect(classify('apps/web/package.json')).toBe('npm');
    expect(classify('.env.example')).toBe('env');
    expect(classify('config/.env.sample')).toBe('env');
    expect(classify('.env')).toBeUndefined();
    expect(classify('.env.local')).toBeUndefined();
    expect(classify('.github/workflows/ci.yml')).toBe('github-workflow');
    expect(classify('src/main/resources/application-prod.yml')).toBe('spring-config');
    expect(classify('requirements/dev.txt')).toBe('requirements');
    expect(classify('src/index.ts')).toBeUndefined();
    expect(classify('deploy/k8s/app.yaml')).toBe('k8s');
    expect(classify('drizzle.config.json')).toBe('drizzle');
    expect(classify('api/src/AppDbContext.cs')).toBe('dotnet-code');
    expect(classify('config/settings/prod.py')).toBe('django-settings');
    expect(classify('docker/compose.override.yaml')).toBe('compose');
    expect(classify('.gitattributes')).toBe('gitattributes');
    expect(classify('sub/.gitattributes')).toBeUndefined();
  });

  it('normalises dependency names and images', () => {
    expect(normalizeDep('pypi', 'Flask_SQLAlchemy')).toBe('flask-sqlalchemy');
    expect(normalizeDep('go', 'github.com/redis/go-redis/v9')).toBe('github.com/redis/go-redis');
    expect(normalizeImage('docker.io/library/postgres:16-alpine')).toBe('postgres');
    expect(normalizeImage('mcr.microsoft.com/mssql/server:2022-latest')).toBe('mssql/server');
    expect(normalizeImage('bitnami/redis@sha256:abc')).toBe('bitnami/redis');
    expect(normalizeImage('localhost:5000/team/app:dev')).toBe('team/app');
  });

  it('parses JVM, .NET, Cargo, Gemfile and pyproject manifests', () => {
    const gradle = parseManifest(
      'gradle',
      'build.gradle.kts',
      `plugins {\n  id("org.springframework.boot") version "3.5.0"\n  kotlin("jvm")\n}\ndependencies {\n  implementation("org.postgresql:postgresql:42.7.7")\n  testImplementation("org.testcontainers:mysql:1.21.0")\n}\n`,
    );
    expect(gradle?.deps).toEqual(
      expect.arrayContaining([
        { eco: 'maven', name: 'plugin:org.springframework.boot', dev: false, spec: '3.5.0' },
        { eco: 'maven', name: 'plugin:org.jetbrains.kotlin.jvm', dev: false },
        { eco: 'maven', name: 'org.postgresql:postgresql', dev: false, spec: '42.7.7' },
        { eco: 'maven', name: 'org.testcontainers:mysql', dev: true, spec: '1.21.0' },
      ]),
    );
    const csproj = parseManifest(
      'csproj',
      'src/Api/Api.csproj',
      `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="9.0.4" />\n  </ItemGroup>\n</Project>\n`,
    );
    expect(csproj?.deps.map((d) => d.name)).toEqual([
      'sdk:Microsoft.NET.Sdk.Web',
      'Npgsql.EntityFrameworkCore.PostgreSQL',
    ]);
    const cargo = parseManifest(
      'cargo',
      'Cargo.toml',
      `[package]\nname = "svc"\n[dependencies]\naxum = "0.8"\nsqlx = { version = "0.8", features = ["runtime-tokio", "postgres"] }\n[workspace]\nmembers = ["crates/*"]\n`,
    );
    expect(cargo?.deps.map((d) => d.name)).toEqual(
      expect.arrayContaining(['axum', 'sqlx', 'sqlx[postgres]', 'sqlx[runtime-tokio]']),
    );
    expect(cargo?.workspaces).toEqual(['crates/*']);
    const gemfile = parseManifest(
      'gemfile',
      'Gemfile',
      `source "https://rubygems.org"\ngem "rails", "~> 8.0"\ngem "pg"\ngroup :development, :test do\n  gem "sqlite3"\nend\ngem "redis"\n`,
    );
    expect(gemfile?.deps).toEqual([
      { eco: 'gem', name: 'rails', dev: false, spec: '~> 8.0' },
      { eco: 'gem', name: 'pg', dev: false },
      { eco: 'gem', name: 'sqlite3', dev: true },
      { eco: 'gem', name: 'redis', dev: false },
    ]);
    const py = parseManifest(
      'pyproject',
      'pyproject.toml',
      `[project]\nname = "x"\ndependencies = ["FastAPI>=0.115", "SQLAlchemy[asyncio]~=2.0", "asyncpg"]\n[dependency-groups]\ndev = ["pytest"]\n`,
    );
    expect(py?.deps).toEqual([
      { eco: 'pypi', name: 'fastapi', dev: false, spec: '>=0.115' },
      { eco: 'pypi', name: 'sqlalchemy', dev: false, spec: '~=2.0' },
      { eco: 'pypi', name: 'asyncpg', dev: false },
      { eco: 'pypi', name: 'pytest', dev: true },
    ]);
    expect(parseManifest('npm', 'package.json', '{ not json')).toEqual({
      deps: [],
      workspaces: [],
      invalid: true,
    });
    expect(parseManifest('sql', 'a.sql', 'SELECT 1')).toBeUndefined();
  });
});

describe('fixture projects', () => {
  it('Next.js + Prisma(postgresql) + Redis monorepo: per-package attribution', async () => {
    const p = await fixture('monorepo');
    expect(p.packages.map((x) => x.dir)).toEqual(['.', 'apps/api', 'apps/web']);
    const web = pkg(p, 'apps/web')!;
    const api = pkg(p, 'apps/api')!;
    expect(web.manifests).toEqual(['apps/web/package.json']);
    expect(web.techs).toEqual(
      expect.arrayContaining(['framework.nextjs', 'framework.react', 'lang.typescript']),
    );
    expect(web.techs).not.toContain('orm.prisma');
    expect(web.techs).not.toContain('framework.fastify');
    expect(api.techs).toEqual(
      expect.arrayContaining([
        'orm.prisma',
        'db.postgresql',
        'db.redis',
        'framework.fastify',
        'lang.typescript',
      ]),
    );
    expect(api.techs).not.toContain('framework.nextjs');
    // repo-root compose / env / CI apply to every package
    expect(web.techs).toEqual(expect.arrayContaining(['infra.docker', 'ci.github-actions', 'db.postgresql']));

    expect(score(p, 'db.postgresql')).toBeGreaterThan(0.95);
    expect(score(p, 'framework.nextjs')).toBeGreaterThan(0.9);
    const pg = p.techs.find((t) => t.id === 'db.postgresql')!;
    expect(pg.reasons).toEqual(
      expect.arrayContaining([
        'Prisma datasource provider "postgresql" (apps/api/prisma/schema.prisma)',
        'image postgres (docker-compose.yml)',
        'URL scheme postgresql:// (.env.example)',
      ]),
    );
    expect(p.languages[0]).toEqual({ id: 'typescript', files: 6 });
    // versions from the manifests
    expect(version(p, 'framework.nextjs')).toBe('15.5.0');
    expect(version(p, 'framework.react')).toBe('19.1.0');
    expect(version(p, 'lang.typescript')).toBe('5.9.0');
    expect(version(p, 'orm.prisma')).toBe('6.16.0');
    expect(version(p, 'framework.fastify')).toBe('5.6.0');
    expect(version(p, 'db.postgresql')).toBe('16'); // compose postgres:16-alpine and CI postgres:16
    expect(version(p, 'db.redis')).toBe('7.4');
    expect(p.techs.find((t) => t.id === 'framework.nextjs')!.reasons.at(-1)).toBe(
      'version 15.5.0 (next in apps/web/package.json)',
    );
    // Node.js runs the API (fastify) and the Next.js server
    expect(pkg(p, 'apps/api')!.techs).toContain('runtime.node');
    expect(pkg(p, 'apps/web')!.techs).toContain('runtime.node');

    const webFile = techsForFile(p, 'apps/web/app/page.tsx');
    expect([...webFile]).toEqual(
      expect.arrayContaining([
        'framework.nextjs',
        'framework.react',
        'lang.typescript',
        'infra.docker',
        'ci.github-actions',
      ]),
    );
    expect(webFile.has('orm.prisma')).toBe(false);
    const apiFile = techsForFile(p, 'apps/api/src/server.ts');
    expect([...apiFile]).toEqual(
      expect.arrayContaining(['orm.prisma', 'db.postgresql', 'db.redis', 'framework.fastify']),
    );
    expect(apiFile.has('framework.nextjs')).toBe(false);
    // A root file only sees root techs; its own language is always included.
    expect(techsForFile(p, 'scripts/seed.py').has('lang.python')).toBe(true);
    expect(techsForFile(p, 'scripts/seed.py').has('framework.nextjs')).toBe(false);

    // Values from env files are never kept.
    expect(JSON.stringify(p)).not.toContain('leak-marker');
  });

  it('Django + Postgres', async () => {
    const p = await fixture('django');
    expect(score(p, 'framework.django')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'orm.django')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'db.postgresql')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'framework.celery')).toBeGreaterThanOrEqual(ACTIVE_SCORE);
    expect(score(p, 'lang.python')).toBeGreaterThanOrEqual(ACTIVE_SCORE);
    expect(p.techs.find((t) => t.id === 'db.postgresql')!.reasons).toEqual(
      expect.arrayContaining([
        'dependency psycopg (requirements.txt)',
        'Django database ENGINE "postgresql" (mysite/settings.py)',
      ]),
    );
    expect(score(p, 'db.mysql')).toBe(0);
    expect(version(p, 'framework.django')).toBe('5.2.6');
    expect(version(p, 'orm.django')).toBe('5.2.6');
    expect(version(p, 'framework.celery')).toBe('5.5.3');
    expect(version(p, 'db.postgresql')).toBeUndefined(); // psycopg 3.2 is a driver, not the server
  });

  it('Spring Boot + MySQL via pom.xml and application.properties', async () => {
    const p = await fixture('spring');
    expect(score(p, 'framework.spring')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'db.mysql')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'orm.hibernate')).toBeGreaterThanOrEqual(0.9);
    expect(score(p, 'lang.java')).toBeGreaterThanOrEqual(ACTIVE_SCORE);
    // the commented-out postgres dependency is ignored
    expect(score(p, 'db.postgresql')).toBe(0);
    expect(p.techs.find((t) => t.id === 'db.mysql')!.reasons).toContain(
      'JDBC URL "mysql" (src/main/resources/application.properties)',
    );
    expect(version(p, 'framework.spring')).toBe('3.5.6'); // spring-boot-starter-parent
    expect(version(p, 'lang.java')).toBeUndefined(); // no java.version: the parent's default is not guessed
  });

  it('Laravel with DB_CONNECTION=pgsql in .env.example', async () => {
    const p = await fixture('laravel');
    expect(score(p, 'framework.laravel')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'orm.eloquent')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'db.postgresql')).toBeGreaterThanOrEqual(0.9);
    expect(score(p, 'db.redis')).toBeGreaterThanOrEqual(0.9);
    expect(score(p, 'lang.php')).toBeGreaterThanOrEqual(ACTIVE_SCORE);
    // config/database.php default 'sqlite' is only a fallback → not active
    expect(score(p, 'db.sqlite')).toBeLessThan(ACTIVE_SCORE);
    expect(JSON.stringify(p)).not.toContain('do-not-leak');
    expect(version(p, 'lang.php')).toBe('8.3');
    expect(version(p, 'framework.laravel')).toBe('12.0');
    expect(version(p, 'orm.eloquent')).toBe('12.0');
  });

  it('Go gin + go-redis', async () => {
    const p = await fixture('go-gin');
    expect(score(p, 'framework.gin')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'db.redis')).toBeGreaterThanOrEqual(0.9);
    expect(score(p, 'lang.go')).toBeGreaterThanOrEqual(0.9);
    expect(p.techs.find((t) => t.id === 'db.redis')!.reasons).toContain(
      'dependency github.com/redis/go-redis (go.mod)',
    );
    expect(version(p, 'lang.go')).toBe('1.25');
    expect(version(p, 'framework.gin')).toBe('1.11.0');
    expect(version(p, 'db.redis')).toBeUndefined(); // go-redis v9 is the client, not the server
  });

  it('docker-compose service images (several databases at once)', async () => {
    const p = await fixture('compose');
    for (const id of ['db.mongodb', 'db.elasticsearch', 'db.clickhouse', 'tool.rabbitmq', 'infra.docker']) {
      expect(score(p, id), id).toBeGreaterThanOrEqual(ACTIVE_SCORE);
    }
    expect(score(p, 'db.postgresql')).toBe(0);
    expect(pkg(p, '.')!.techs).toEqual(expect.arrayContaining(['db.mongodb', 'db.clickhouse']));
    // server versions from image tags; a Dockerfile FROM node alone is weak evidence for runtime.node
    expect(version(p, 'db.mongodb')).toBe('8');
    expect(version(p, 'db.elasticsearch')).toBe('9.1.0');
    expect(version(p, 'db.clickhouse')).toBe('25.8');
    expect(version(p, 'tool.rabbitmq')).toBeUndefined();
    expect(version(p, 'runtime.node')).toBe('22');
    expect(score(p, 'runtime.node')).toBe(0.5);
  });

  it('GitHub Actions workflows and CI service containers', async () => {
    const p = await fixture('gha');
    expect(score(p, 'ci.github-actions')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'db.redis')).toBeGreaterThanOrEqual(ACTIVE_SCORE);
    expect(score(p, 'db.mysql')).toBeGreaterThanOrEqual(ACTIVE_SCORE);
    // one action reference is weak evidence only
    const aws = p.techs.find((t) => t.id === 'cloud.aws')!;
    expect(aws.score).toBeGreaterThanOrEqual(WEAK_SCORE);
    expect(aws.score).toBeLessThan(ACTIVE_SCORE);
    expect(pkg(p, '.')!.techs).not.toContain('cloud.aws');
    expect(techsForFile(p, 'scripts/release.sh')).toEqual(
      new Set(['ci.github-actions', 'db.redis', 'db.mysql', 'lang.shell']),
    );
  });
});

describe('scoring and safety', () => {
  it('dev-only dependencies are weak; examples/ is dampened; .env is never read', async () => {
    const root = tempDir({
      'package.json': JSON.stringify({ dependencies: { express: '5' }, devDependencies: { pg: '8' } }),
      '.env': 'DATABASE_URL=mongodb://user:secret@host/db\n',
      'examples/next-app/package.json': JSON.stringify({ dependencies: { next: '15' } }),
    });
    const p = await detectStack({ root });
    const pg = p.techs.find((t) => t.id === 'db.postgresql')!;
    expect(pg.score).toBe(0.5);
    expect(pg.reasons).toEqual(['dev dependency pg (package.json)']);
    expect(pkg(p, '.')!.techs).toContain('framework.express');
    expect(pkg(p, '.')!.techs).not.toContain('db.postgresql');
    expect(score(p, 'db.mongodb')).toBe(0);
    expect(score(p, 'framework.nextjs')).toBeLessThan(WEAK_SCORE);
  });

  it('applies implications (Nuxt → Vue, Supabase → PostgreSQL)', async () => {
    const root = tempDir({
      'package.json': JSON.stringify({ dependencies: { nuxt: '4', '@supabase/supabase-js': '2' } }),
    });
    const p = await detectStack({ root });
    const vue = p.techs.find((t) => t.id === 'framework.vue')!;
    expect(vue.score).toBe(score(p, 'framework.nuxt'));
    expect(vue.reasons).toEqual(['implied by Nuxt']);
    expect(p.techs.find((t) => t.id === 'db.postgresql')!.reasons).toEqual(['implied by Supabase']);
    expect(pkg(p, '.')!.techs).toEqual(
      expect.arrayContaining(['framework.nuxt', 'framework.vue', 'cloud.supabase', 'db.postgresql']),
    );
  });

  it('does not follow symlinks on disk', async () => {
    const outside = tempDir({
      'package.json': JSON.stringify({ dependencies: { mongoose: '8' } }),
      'app/package.json': JSON.stringify({ dependencies: { next: '15' } }),
    });
    const root = tempDir({ 'src/index.js': 'export {};\n' });
    symlinkSync(path.join(outside, 'package.json'), path.join(root, 'package.json'));
    symlinkSync(path.join(outside, 'app'), path.join(root, 'linked'));
    const walked = await detectStack({ root });
    expect(score(walked, 'db.mongodb')).toBe(0);
    expect(score(walked, 'framework.nextjs')).toBe(0);
    // Even when the caller lists the paths explicitly.
    const given = await detectStack({
      root,
      files: ['package.json', 'linked/package.json', '../x/package.json'],
    });
    expect(given.filesRead).toBe(0);
    expect(score(given, 'db.mongodb')).toBe(0);
  });

  it('respects the file cap and reports it', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++)
      files[`pkgs/p${String(i).padStart(2, '0')}/package.json`] = '{"dependencies":{"react":"19"}}';
    const p = await detectStack({ root: tempDir(files), limits: { maxFiles: 5 } });
    expect(p.filesRead).toBe(5);
    expect(p.notes.join('\n')).toMatch(/file cap reached: 7 more/);
    const picked = pickCandidates(
      Object.keys(files).map((f) => ({ path: f })),
      { maxFiles: 300, maxFileBytes: 1, maxTotalBytes: 1e9, budgetMs: 1, maxDepth: 1, maxListed: 1 },
    );
    expect(picked.picked).toEqual([]); // deeper than maxDepth
  });

  it('is fast on large listings', async () => {
    const files: string[] = [];
    for (let i = 0; i < 100_000; i++) files.push(`packages/p${i % 500}/src/module${i}.ts`);
    for (let i = 0; i < 500; i++) files.push(`packages/p${i}/package.json`);
    const t0 = performance.now();
    const p = await detectStack({ root: tempDir({}), files });
    const ms = performance.now() - t0;
    expect(p.filesScanned).toBe(100_500);
    expect(p.packages.length).toBe(501);
    expect(ms).toBeLessThan(1_500);
    const analyzeOnly = performance.now();
    analyze({ files: files.slice(0, 5_000), contents: new Map(), notes: [] });
    expect(performance.now() - analyzeOnly).toBeLessThan(250);
  });

  it('weights languages by file count and share; notes unparsable manifests', async () => {
    const root = tempDir({
      'package.json': '{ "dependencies": { "react": ',
      'deploy.sh': '#!/bin/sh\n',
      'eslint.config.js': 'export default [];\n',
      'svc/go.mod': 'module example.com/svc\n\ngo 1.25\n',
      'svc/main.go': 'package main\n',
      'svc/util.go': 'package main\n',
    });
    const p = await detectStack({ root });
    expect(pkg(p, 'svc')!.techs).toContain('lang.go');
    // one shell script and a tool config do not make the root a shell / JavaScript package
    expect(pkg(p, '.')!.techs).not.toContain('lang.shell');
    expect(score(p, 'lang.javascript')).toBe(0);
    expect(techsForFile(p, 'deploy.sh').has('lang.shell')).toBe(true);
    expect(p.notes).toContain('could not parse package.json');
    expect(score(p, 'framework.react')).toBe(0);
  });

  it('reads Cargo features, csproj + EF Core, Rails database.yml, Spring YAML, Terraform, Helm, SQL', async () => {
    const root = tempDir({
      'rust/Cargo.toml':
        '[package]\nname = "svc"\n[dependencies]\naxum = "0.8"\nsqlx = { version = "0.8", features = ["postgres"] }\n',
      'dotnet/Api.csproj':
        '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n    <PackageReference Include="Microsoft.EntityFrameworkCore" Version="9.0.0" />\n  </ItemGroup>\n</Project>\n',
      'dotnet/Program.cs': 'builder.Services.AddDbContext<Db>(o => o.UseSqlServer(cs));\n',
      'rails/Gemfile': 'gem "rails"\n',
      'rails/config/database.yml': 'default: &default\n  adapter: mysql2\n',
      'kotlin/build.gradle.kts':
        'plugins {\n  id("org.springframework.boot") version "3.5.0"\n  kotlin("jvm")\n}\n',
      'kotlin/src/main/resources/application.yml':
        'spring:\n  data:\n    mongodb:\n      uri: mongodb://localhost/app\n',
      'infra/main.tf': 'provider "aws" {\n  region = "eu-west-1"\n}\nresource "aws_dynamodb_table" "t" {}\n',
      'charts/app/Chart.yaml':
        'apiVersion: v2\nname: app\ndependencies:\n  - name: redis\n    version: 20.x\n',
      'db/schema.sql': 'CREATE TABLE t (id BIGSERIAL PRIMARY KEY, doc JSONB);\n',
    });
    const p = await detectStack({ root });
    const techs = (dir: string) => pkg(p, dir)!.techs;
    expect(techs('rust')).toEqual(
      expect.arrayContaining(['framework.axum', 'orm.sqlx', 'db.postgresql', 'lang.rust']),
    );
    expect(techs('dotnet')).toEqual(
      expect.arrayContaining(['framework.aspnet', 'orm.efcore', 'db.sqlserver', 'lang.csharp']),
    );
    expect(techs('rails')).toEqual(
      expect.arrayContaining(['framework.rails', 'orm.activerecord', 'db.mysql']),
    );
    expect(techs('kotlin')).toEqual(
      expect.arrayContaining(['framework.spring', 'db.mongodb', 'lang.kotlin']),
    );
    expect(techs('kotlin')).not.toContain('db.postgresql');
    // repo-root infra applies everywhere
    expect(techs('rust')).toEqual(
      expect.arrayContaining(['infra.terraform', 'cloud.aws', 'infra.helm', 'infra.kubernetes']),
    );
    expect(score(p, 'db.dynamodb')).toBe(0.6);
    expect(score(p, 'db.redis')).toBe(0.7);
    // SQL dialect hints alone are weak
    expect(pkg(p, '.')!.techs).not.toContain('db.postgresql');
    expect(p.techs.find((t) => t.id === 'db.postgresql')!.packages).toEqual(['.', 'rust']);
  });

  it('reads GitLab CI services, Jenkinsfile, Kubernetes manifests and JS ORM configs', async () => {
    const root = tempDir({
      '.gitlab-ci.yml':
        'test:\n  image: node:22\n  services:\n    - postgres:16\n    - name: redis:7\n      alias: cache\n',
      Jenkinsfile: 'pipeline { agent any }\n',
      'deploy/k8s/api.yaml':
        'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: search\n          image: opensearchproject/opensearch:3\n---\napiVersion: v1\nkind: Service\n',
      'web/package.json': JSON.stringify({ dependencies: { 'drizzle-orm': '0.44' } }),
      'web/drizzle.config.ts': "export default { dialect: 'mysql', schema: './schema.ts' };\n",
      'jobs/package.json': JSON.stringify({ dependencies: { knex: '3' } }),
      'jobs/knexfile.js': "module.exports = { client: 'pg' };\n",
    });
    const p = await detectStack({ root });
    expect(score(p, 'ci.gitlab-ci')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'ci.jenkins')).toBeGreaterThanOrEqual(0.95);
    expect(score(p, 'infra.kubernetes')).toBeGreaterThanOrEqual(0.9);
    expect(pkg(p, '.')!.techs).toEqual(expect.arrayContaining(['db.postgresql', 'db.redis']));
    expect(score(p, 'db.elasticsearch')).toBe(0.5); // k8s images are weaker evidence
    expect(pkg(p, 'web')!.techs).toEqual(expect.arrayContaining(['orm.drizzle', 'db.mysql']));
    expect(pkg(p, 'jobs')!.techs).toEqual(expect.arrayContaining(['orm.knex', 'db.postgresql']));
    expect(pkg(p, 'jobs')!.techs).not.toContain('db.mysql');
  });

  it('reads every manifest of a large monorepo within the global cap', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 80; i++) {
      files[`pkgs/p${String(i).padStart(2, '0')}/package.json`] = JSON.stringify({
        dependencies: i === 79 ? { mongodb: '6' } : { react: '19' },
      });
    }
    const p = await detectStack({ root: tempDir(files) });
    expect(p.filesRead).toBe(80);
    expect(p.notes).toEqual([]);
    expect(pkg(p, 'pkgs/p79')!.techs).toContain('db.mongodb');
  });

  it('honours linguist-vendored in .gitattributes and workspace declarations', async () => {
    const root = tempDir({
      '.gitattributes': 'third/** linguist-vendored\n*.gen.ts linguist-generated=true\n',
      'package.json': JSON.stringify({ workspaces: ['libs/*'] }),
      'libs/ui/index.ts': 'export {};\n',
      'third/lib/package.json': JSON.stringify({ dependencies: { mongoose: '8' } }),
      'src/a.gen.ts': 'export {};\n',
    });
    const p = await detectStack({ root });
    expect(score(p, 'db.mongodb')).toBe(0);
    expect(p.packages.map((x) => x.dir)).toEqual(['.', 'libs/ui']);
    expect(p.languages).toEqual([
      { id: 'json', files: 1 },
      { id: 'typescript', files: 1 },
    ]);
  });
});

/** `tech@version` of every version the manifest declares. */
const declared = (kind: FileKind, file: string, text: string) =>
  (parseManifest(kind, file, text)?.versions ?? []).map((d) => `${d.tech}@${d.version.join('.')}`);
/** Dependency name → declared spec. */
const specs = (kind: FileKind, file: string, text: string) =>
  Object.fromEntries(
    (parseManifest(kind, file, text)?.deps ?? []).filter((d) => d.spec).map((d) => [d.name, d.spec]),
  );
const v = (x: number[] | undefined) => x?.join('.');
/** A literal `${name}` build-variable reference (Maven, Dockerfile). */
const ref = (name: string) => `\${${name}}`;

describe('version helpers', () => {
  it.each([
    ['^15.0.3', '15.0.3'],
    ['>=3.10,<4', '3.10'],
    ['~> 7.1, >= 7.1.3.4', '7.1.3.4'],
    ['[8.0.0, 9.0.0)', '8.0.0'],
    ['v1.9.1', '1.9.1'],
    ['1.2.3 - 2.0.0', '1.2.3'],
    ['^18 || ^19', '18'],
    ['^8.2|^8.3', '8.2'],
    ['3.x', '3'],
    ['==5.1.*', '5.1'],
    ['19.0.0-rc-66855b96-20241106', '19.0.0'],
    ['>=1.0rc2', '1.0'],
    ['~> 7.1.0.beta1', '7.1.0'],
    ['3.3.4.RELEASE', '3.3.4'],
    ['v1.2.4-0.20191109021931-daa7c04131f5', '1.2.4'],
    ['v2.0.0+incompatible', '2.0.0'],
    ['15.0.0-canary.1', '15.0.0'],
    ['8.0.0-preview.7.23375.6', '8.0.0'],
  ])('specVersion(%s) = %s', (spec, expected) => {
    expect(v(specVersion(spec))).toBe(expected);
  });

  it.each([
    'latest',
    '*',
    '<4',
    'workspace:*',
    'catalog:',
    'github:user/repo#v1.2.3',
    'user/repo2',
    'file:../lib',
    'https://example.com/x-1.2.3.tgz',
    ref('kotlin.version'),
    '$(EfCoreVersion)',
    '$springBootVersion',
    '0.0.0-experimental-7f3a',
    'v0.0.0-20240101000000-abcdef123456',
    'x'.repeat(201),
  ])('specVersion(%s) is unknown', (spec) => {
    expect(specVersion(spec)).toBeUndefined();
  });

  it('npm aliases count only for the same package', () => {
    expect(v(depSpecVersion('react', 'npm:react@^18.3.1'))).toBe('18.3.1');
    expect(depSpecVersion('react', 'npm:@preact/compat@^17.1.2')).toBeUndefined();
    expect(v(depSpecVersion('@scope/x', 'npm:@scope/x@2.1.0'))).toBe('2.1.0');
  });

  it('reads runtime, language and image version notations', () => {
    expect(v(nodeVersion('v22.11.0'))).toBe('22.11.0');
    expect(v(nodeVersion('lts/iron'))).toBe('20');
    expect(v(nodeVersion('Jod'))).toBe('22');
    expect(nodeVersion('lts/*')).toBeUndefined();
    expect(nodeVersion('node')).toBeUndefined();
    expect(v(pythonVersion('cpython@3.12'))).toBe('3.12');
    expect(v(pythonVersion('pypy3.10-7.3.12'))).toBe('3.10');
    expect(v(pythonVersion('3.13t'))).toBe('3.13');
    expect(v(pythonVersion('>=3.11,<3.13'))).toBe('3.11');
    expect(pythonVersion('system')).toBeUndefined();
    expect(v(javaVersion('1.8'))).toBe('8');
    expect(v(javaVersion('1_8'))).toBe('8');
    expect(v(javaVersion('21'))).toBe('21');
    expect(tfmVersion('net8.0')).toEqual({ version: [8, 0], modern: true });
    expect(tfmVersion('net10.0-windows10.0.19041.0')).toEqual({ version: [10, 0], modern: true });
    expect(tfmVersion('netcoreapp3.1')).toEqual({ version: [3, 1], modern: true });
    expect(tfmVersion('net472')).toEqual({ version: [4, 7, 2], modern: false });
    expect(tfmVersion('netstandard2.0')).toBeUndefined();
    expect(imageTag('docker.io/library/node:22-alpine@sha256:abc')).toBe('22-alpine');
    expect(imageTag('localhost:5000/team/app')).toBeUndefined();
    expect(v(imageTagVersion('jod-alpine', { codenames: true }))).toBe('22');
    expect(imageTagVersion('lts-alpine', { codenames: true })).toBeUndefined();
    expect(
      v(imageTagVersion('alpine-2.1.4', { tagPrefix: /^(?:alpine|debian|distroless|ubuntu|bin)-/ })),
    ).toBe('2.1.4');
    expect(v(imageTagVersion('2022-CU15-ubuntu-22.04'))).toBe('2022');
    expect(substituteArgs(`node:${ref('NODE_VERSION')}-alpine`, new Map([['NODE_VERSION', '20.18']]))).toBe(
      'node:20.18-alpine',
    );
    expect(substituteArgs(`python:${ref('PY:-3.12')}-slim`, new Map())).toBe('python:3.12-slim');
    expect(substituteArgs('node:$MISSING', new Map())).toBeUndefined();
  });

  it('version tables only use canonical tech ids', () => {
    for (const d of VERSION_DEPS) for (const t of d.techs) expect(isTechId(t), t).toBe(true);
    for (const i of VERSION_IMAGES) expect(isTechId(i.tech), i.tech).toBe(true);
  });
});

describe('manifest versions', () => {
  it('package.json: dependency specs incl. dev / peer, runtime fields, Bun catalogs', () => {
    const text = JSON.stringify({
      dependencies: { next: '^15.0.3', 'react-dom': 'npm:react-dom@19.0.0' },
      devDependencies: { typescript: '~5.6.2' },
      peerDependencies: { react: '>=18' },
      engines: { node: '>=20.9', bun: '>=1.1' },
      volta: { node: '22.11.0' },
      devEngines: { runtime: [{ name: 'node', version: '>=22' }, { name: 'java' }] },
      packageManager: 'bun@1.1.30',
      workspaces: { packages: ['apps/*'], catalog: { zod: '^3.23.8' } },
    });
    const info = parseManifest('npm', 'package.json', text)!;
    expect(specs('npm', 'package.json', text)).toEqual({
      next: '^15.0.3',
      'react-dom': 'npm:react-dom@19.0.0',
      typescript: '~5.6.2',
      react: '>=18',
      'engines:node': '>=20.9',
      'engines:bun': '>=1.1',
      'volta:node': '22.11.0',
      'devEngines:node': '>=22',
      'packageManager:bun': '1.1.30',
    });
    expect(info.workspaces).toEqual(['apps/*']);
    expect(info.catalogs?.get('default')?.get('zod')).toBe('^3.23.8');
  });

  it('Python: requires-python, PEP 508 specs with extras / markers / options, Poetry and Pipfile', () => {
    const pyproject =
      '[project]\nrequires-python = ">=3.10"\ndependencies = ["Django[argon2]>=4.2,<5 ; python_version >= \\"3.10\\"", "celery @ git+https://x/celery"]\n' +
      '[tool.poetry.dependencies]\npython = "^3.11"\nfastapi = { version = "^0.115.0", optional = true }\n';
    expect(declared('pyproject', 'pyproject.toml', pyproject)).toEqual([
      'lang.python@3.10',
      'lang.python@3.11',
    ]);
    expect(specs('pyproject', 'pyproject.toml', pyproject)).toEqual({
      django: '>=4.2,<5',
      fastapi: '^0.115.0',
    });
    const req =
      'Django==4.2.16 \\\n    --hash=sha256:abc\nflask>=3.0 --hash=sha256:def  # web\n-r base.txt\n';
    expect(specs('requirements', 'requirements.txt', req)).toEqual({ django: '==4.2.16', flask: '>=3.0' });
    const pipfile =
      '[packages]\ndjango = "==5.0.9"\nrequests = "*"\ncelery = {version = ">=5.4", extras = ["redis"]}\n[requires]\npython_version = "3.12"\n';
    expect(declared('pipfile', 'Pipfile', pipfile)).toEqual(['lang.python@3.12']);
    expect(specs('pipfile', 'Pipfile', pipfile)).toEqual({
      django: '==5.0.9',
      requests: '*',
      celery: '>=5.4',
    });
  });

  it('go.mod: the go directive (not the toolchain) is the language version; 1.16 when missing', () => {
    const mod =
      'module x\n\ngo 1.22.1\n\ntoolchain go1.23.4\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n)\n';
    expect(declared('gomod', 'go.mod', mod)).toEqual(['lang.go@1.22.1']);
    expect(specs('gomod', 'go.mod', mod)).toEqual({ 'github.com/gin-gonic/gin': 'v1.10.0' });
    expect(declared('gomod', 'go.mod', 'module x\n\nrequire github.com/go-chi/chi/v5 v5.1.0\n')).toEqual([
      'lang.go@1.16',
    ]);
  });

  it('Cargo: MSRV (package and workspace) and dependency versions', () => {
    const cargo =
      '[package]\nname = "a"\nrust-version = "1.74"\n[workspace.package]\nrust-version = "1.80.1"\n' +
      '[dependencies]\naxum = "0.7"\nsqlx = { version = "0.8.2", features = ["postgres"] }\ntokio = { workspace = true }\n';
    expect(declared('cargo', 'Cargo.toml', cargo)).toEqual(['lang.rust@1.74', 'lang.rust@1.80.1']);
    expect(specs('cargo', 'Cargo.toml', cargo)).toEqual({ axum: '0.7', sqlx: '0.8.2' });
  });

  it('pom.xml: parent version, properties, compiler plugin (1.8 → 8), Kotlin via property', () => {
    const pom = `<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>\${boot.version}</version></parent>
  <properties><boot.version>2.7.18</boot.version><kotlin.version>1.9.25</kotlin.version><java.version>17</java.version></properties>
  <dependencies>
    <dependency><groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-stdlib</artifactId><version>\${kotlin.version}</version></dependency>
    <dependency><groupId>org.x</groupId><artifactId>y</artifactId><version>\${unknown.version}</version></dependency>
  </dependencies>
  <build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><configuration><source>1.8</source><target>1.8</target></configuration></plugin></plugins></build>
</project>`;
    expect(declared('pom', 'pom.xml', pom)).toEqual([
      'lang.java@8',
      'lang.java@8',
      'lang.java@17', // java.version
    ]);
    expect(specs('pom', 'pom.xml', pom)).toEqual({
      'org.springframework.boot:spring-boot-starter-parent': '2.7.18',
      'org.jetbrains.kotlin:kotlin-stdlib': '1.9.25',
      'org.x:y': ref('unknown.version'),
    });
  });

  it('Gradle: plugin versions (Groovy / Kotlin DSL), coordinates, toolchains and compatibility', () => {
    const groovy = `plugins {
  id 'org.springframework.boot' version '3.1.12'
  id 'org.jetbrains.kotlin.jvm' version '1.9.25' apply false
}
java { sourceCompatibility = JavaVersion.VERSION_1_8 }
tasks.withType(JavaCompile).configureEach { options.release = 11 }
dependencies {
  implementation "com.google.guava:guava:33.3.1-jre"
  implementation group: 'org.hibernate.orm', name: 'hibernate-core', version: '6.6.1.Final'
  implementation "org.x:y:$yVersion"
}`;
    expect(declared('gradle', 'build.gradle', groovy)).toEqual(['lang.java@8', 'lang.java@11']);
    expect(specs('gradle', 'build.gradle', groovy)).toEqual({
      'plugin:org.springframework.boot': '3.1.12',
      'plugin:org.jetbrains.kotlin.jvm': '1.9.25',
      'com.google.guava:guava': '33.3.1-jre',
      'org.hibernate.orm:hibernate-core': '6.6.1.Final',
      'org.x:y': '$yVersion',
    });
    const kts = 'plugins {\n  kotlin("jvm") version "2.0.21"\n}\nkotlin { jvmToolchain(21) }\n';
    expect(declared('gradle', 'build.gradle.kts', kts)).toEqual(['lang.java@21']);
    expect(specs('gradle', 'build.gradle.kts', kts)).toEqual({ 'plugin:org.jetbrains.kotlin.jvm': '2.0.21' });
  });

  it('Gradle version catalog: version.ref, rich versions, string forms', () => {
    const toml =
      '[versions]\nboot = "3.3.4"\nkotlin = { strictly = "2.0.21" }\n' +
      '[libraries]\nstdlib = { module = "org.jetbrains.kotlin:kotlin-stdlib", version.ref = "kotlin" }\nguava = "com.google.guava:guava:33.0.0-jre"\n' +
      '[plugins]\nboot = { id = "org.springframework.boot", version.ref = "boot" }\nversions = "com.github.ben-manes.versions:0.51.0"\n';
    expect(specs('gradle-catalog', 'gradle/libs.versions.toml', toml)).toEqual({
      'org.jetbrains.kotlin:kotlin-stdlib': '2.0.21',
      'com.google.guava:guava': '33.0.0-jre',
      'plugin:org.springframework.boot': '3.3.4',
      'plugin:com.github.ben-manes.versions': '0.51.0',
    });
  });

  it('.NET: TargetFramework(s), .NET Framework, F# projects, PackageReference forms, $(Properties)', () => {
    const csproj = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFrameworks>net9.0;net8.0;netstandard2.0</TargetFrameworks><Ef>9.0.1</Ef></PropertyGroup>
  <ItemGroup>
    <PackageReference Version="$(Ef)" Include="Microsoft.EntityFrameworkCore" />
    <PackageReference Include="Serilog">
      <Version>4.1.0</Version>
    </PackageReference>
  </ItemGroup>
</Project>`;
    expect(declared('csproj', 'src/Api/Api.csproj', csproj)).toEqual([
      'lang.csharp@9.0',
      'framework.aspnet@9.0',
      'lang.csharp@8.0',
      'framework.aspnet@8.0',
    ]);
    expect(specs('csproj', 'src/Api/Api.csproj', csproj)).toEqual({
      'Microsoft.EntityFrameworkCore': '9.0.1',
      Serilog: '4.1.0',
    });
    expect(
      declared(
        'csproj',
        'Lib.fsproj',
        '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
      ),
    ).toEqual(['framework.aspnet@8.0']);
    expect(
      declared(
        'csproj',
        'Old.csproj',
        '<Project><PropertyGroup><TargetFramework>net48</TargetFramework></PropertyGroup></Project>',
      ),
    ).toEqual(['lang.csharp@4.8']);
    const props =
      '<Project><ItemGroup><PackageVersion Include="Microsoft.EntityFrameworkCore.Design" Version="8.0.10" /></ItemGroup></Project>';
    expect(specs('nuget-props', 'Directory.Packages.props', props)).toEqual({
      'Microsoft.EntityFrameworkCore.Design': '8.0.10',
    });
    expect(classify('Directory.Build.props')).toBe('nuget-props');
  });

  it('composer.json: require.php, config.platform.php, extra.symfony.require', () => {
    const composer = JSON.stringify({
      require: { php: '>=8.2', 'symfony/framework-bundle': '*' },
      config: { platform: { php: '8.3.12' } },
      extra: { symfony: { require: '7.1.*' } },
    });
    expect(declared('composer', 'composer.json', composer)).toEqual([
      'lang.php@8.2',
      'lang.php@8.3.12',
      'framework.symfony@7.1',
    ]);
  });

  it('Gemfile and Gemfile.lock (Bundler 2 and 4 indentation, GIT specs, CHECKSUMS ignored)', () => {
    const gemfile = 'ruby "~> 3.3.0"\ngem "rails", "~> 7.1.3", ">= 7.1.3.4"\ngem "puma", require: false\n';
    expect(declared('gemfile', 'Gemfile', gemfile)).toEqual(['lang.ruby@3.3.0']);
    expect(specs('gemfile', 'Gemfile', gemfile)).toEqual({ rails: '~> 7.1.3, >= 7.1.3.4' });
    const lock = `GIT
  remote: https://github.com/rails/rails.git
  revision: abc
  specs:
    rails (8.1.0.alpha)
      actionpack (= 8.1.0.alpha)

GEM
  remote: https://rubygems.org/
  specs:
    nokogiri (1.16.7-x86_64-linux)
      racc (~> 1.4)
    pg (1.5.8)

CHECKSUMS
  pg (1.5.8) sha256=0123

RUBY VERSION
  ruby 3.4.1

BUNDLED WITH
  4.0.0
`;
    const info = parseManifest('gemfile-lock', 'Gemfile.lock', lock)!;
    expect(info.deps).toEqual([]); // lockfiles never count as detection evidence
    expect(info.locked?.map((d) => `${d.name}@${d.spec}`)).toEqual([
      'rails@8.1.0.alpha',
      'nokogiri@1.16.7-x86_64-linux',
      'pg@1.5.8',
    ]);
    expect(info.versions).toEqual([
      { tech: 'lang.ruby', version: [3, 4, 1], what: 'Gemfile.lock RUBY VERSION', fallback: true },
    ]);
    expect(declared('gemfile-lock', 'Gemfile.lock', 'RUBY VERSION\n   ruby 3.3.5p100\n')).toEqual([
      'lang.ruby@3.3.5',
    ]);
  });

  it('pubspec.yaml and mix.exs', () => {
    const pubspec =
      'name: app\nenvironment:\n  sdk: ">=3.4.0 <4.0.0"\n  flutter: ">=3.22.0"\ndependencies:\n  http: ^1.2.2\n  flutter:\n    sdk: flutter\n';
    expect(declared('pubspec', 'pubspec.yaml', pubspec)).toEqual([
      'lang.dart@3.4.0',
      'framework.flutter@3.22.0',
    ]);
    expect(specs('pubspec', 'pubspec.yaml', pubspec)).toEqual({ http: '^1.2.2' });
    const mix =
      'def project do\n  [app: :x, elixir: "~> 1.15", deps: deps()]\nend\ndefp deps, do: [{:phoenix, "~> 1.7.14"}, {:ecto_sql, "~> 3.10"}]\n';
    expect(declared('mix', 'mix.exs', mix)).toEqual(['lang.elixir@1.15']);
    expect(specs('mix', 'mix.exs', mix)).toEqual({ phoenix: '~> 1.7.14', ecto_sql: '~> 3.10' });
  });

  it.each([
    ['.nvmrc', '# comment\nv20.18.0\n', ['runtime.node@20.18.0']],
    ['.nvmrc', 'lts/iron\n', ['runtime.node@20']],
    ['.nvmrc', 'lts/*\n', []],
    ['.node-version', '22\n', ['runtime.node@22']],
    ['.python-version', '3.12\n3.11.9\n', ['lang.python@3.12', 'lang.python@3.11.9']],
    ['.python-version', 'cpython@3.13\n', ['lang.python@3.13']],
    ['runtime.txt', 'python-3.12.4\n', ['lang.python@3.12.4']],
    ['runtime.txt', 'php-8.3\n', []],
    ['.ruby-version', 'ruby-3.3.5\n', ['lang.ruby@3.3.5']],
    ['.ruby-version', 'jruby-9.4.8.0\n', []],
    ['.bun-version', '1.1.30\n', ['runtime.bun@1.1.30']],
    ['.swift-version', '6.0.2\n', ['lang.swift@6.0.2']],
    [
      'rust-toolchain.toml',
      '[toolchain]\nchannel = "1.81.0"\ncomponents = ["clippy"]\n',
      ['lang.rust@1.81.0'],
    ],
    ['rust-toolchain.toml', '[toolchain]\nchannel = "nightly-2024-05-01"\n', []],
    ['rust-toolchain', '1.80\n', ['lang.rust@1.80']],
    ['rust-toolchain', 'stable\n', []],
  ])('version file %s %j', (file, text, expected) => {
    expect(classify(`svc/${file}`)).toBe('version-file');
    expect(declared('version-file', `svc/${file}`, text)).toEqual(expected);
  });

  it('.tool-versions and Package.swift', () => {
    const tools =
      '# tools\nnodejs 22.11.0 20.18.0\npython 3.12.7 system\njava temurin-21.0.4+7.0.LTS\ngolang 1.23.2\nruby ref:v3_4_0\nterraform 1.9.8\n';
    expect(classify('.tool-versions')).toBe('tool-versions');
    expect(declared('tool-versions', '.tool-versions', tools)).toEqual([
      'runtime.node@22.11.0',
      'runtime.node@20.18.0',
      'lang.python@3.12.7',
      'lang.java@21.0.4',
    ]);
    expect(classify('Package.swift')).toBe('swift-package');
    expect(
      declared('swift-package', 'Package.swift', '// swift-tools-version:5.9\nimport PackageDescription\n'),
    ).toEqual(['lang.swift@5.9']);
    expect(declared('swift-package', 'Package.swift', '// swift-tools-version: 6.0\n')).toEqual([
      'lang.swift@6.0',
    ]);
    expect(
      declared('swift-package', 'Package.swift', 'import PackageDescription\n// swift-tools-version:5.9\n'),
    ).toEqual([]);
  });
});

describe('detected versions', () => {
  it('polyglot monorepo: per-package versions, lowest wins, catalogs, dampened examples ignored', async () => {
    const p = await fixture('versions');
    const hit = (id: string) => p.techs.find((t) => t.id === id);
    // JavaScript: Next 15 + React 19 (pnpm catalog) + TypeScript 5.6 vs. a legacy Next 13 + React 18 app
    expect(hit('framework.nextjs')).toMatchObject({
      version: '13.5.6',
      versions: { 'apps/legacy': '13.5.6', 'apps/web': '15.0.3' },
    });
    expect(hit('framework.react')).toMatchObject({
      version: '18.3.1',
      versions: { 'apps/legacy': '18.3.1', 'apps/web': '19.0.0' },
    });
    expect(hit('lang.typescript')).toMatchObject({
      version: '5.6.2',
      versions: { '.': '5.6.2', 'apps/web': '5.6.3' },
    });
    // engines.node >=22 + .nvmrc 22.11.0 (root), engines + Dockerfile node:${NODE_VERSION} (web), lts/hydrogen (legacy)
    expect(hit('runtime.node')).toMatchObject({
      version: '18',
      versions: { '.': '22', 'apps/legacy': '18', 'apps/web': '22' },
    });
    expect(hit('runtime.node')!.score).toBeGreaterThanOrEqual(ACTIVE_SCORE);
    expect(hit('framework.nextjs')!.reasons.at(-1)).toBe('version 13.5.6 (next in apps/legacy/package.json)');
    // Go 1.21 vs 1.23 modules; frameworks keep their own versions
    expect(hit('lang.go')).toMatchObject({
      version: '1.21',
      versions: { 'services/billing': '1.21', 'services/search': '1.23.2' },
    });
    expect(version(p, 'framework.gin')).toBe('1.9.1');
    expect(version(p, 'framework.echo')).toBe('4.12.0');
    // Django pin, .python-version
    expect(version(p, 'framework.django')).toBe('5.1.2');
    expect(version(p, 'orm.django')).toBe('5.1.2');
    expect(version(p, 'lang.python')).toBe('3.12');
    // Spring Boot 3.3 parent + Java 21 (Maven) vs. Boot 3.2 plugin + toolchain 17 + Kotlin 1.9 (Gradle)
    expect(hit('framework.spring')).toMatchObject({
      version: '3.2.5',
      versions: { 'services/inventory': '3.2.5', 'services/orders': '3.3.4' },
    });
    expect(hit('lang.java')).toMatchObject({
      version: '17',
      versions: { 'services/inventory': '17', 'services/orders': '21' },
    });
    expect(version(p, 'lang.kotlin')).toBe('1.9.24');
    expect(version(p, 'orm.hibernate')).toBeUndefined(); // managed by the Boot parent: not declared
    // .NET 8
    expect(version(p, 'lang.csharp')).toBe('8.0');
    expect(version(p, 'framework.aspnet')).toBe('8.0');
    expect(version(p, 'orm.efcore')).toBe('8.0.10'); // Version="$(EfVersion)"
    // PHP ^8.3 + Laravel ^11
    expect(version(p, 'lang.php')).toBe('8.3');
    expect(version(p, 'framework.laravel')).toBe('11.0');
    expect(version(p, 'orm.eloquent')).toBe('11.0');
    // Rails ~> 7.1: the Gemfile requirement wins over the lockfile (fallback only)
    expect(version(p, 'framework.rails')).toBe('7.1');
    expect(version(p, 'orm.activerecord')).toBe('7.1');
    expect(version(p, 'lang.ruby')).toBe('3.3.5');
    // Deno and Bun
    expect(pkg(p, 'tools/deno-fn')!.techs).toContain('runtime.deno');
    expect(version(p, 'runtime.deno')).toBe('2.0.6');
    expect(pkg(p, 'tools/bun-worker')!.techs).toContain('runtime.bun');
    expect(version(p, 'runtime.bun')).toBe('1.1.30');
    // server versions from compose image tags
    expect(version(p, 'db.postgresql')).toBe('16.4');
    expect(version(p, 'db.redis')).toBe('7.4');
    // examples/old-next pins next 12.3.4: dampened, it must not lower the project's version
    expect(JSON.stringify(p.techs)).not.toContain('12.3.4');
    expect(p.notes).toEqual([]);
  });

  it('techVersionsForFiles: the nearest package decides; files that disagree leave the tech out', async () => {
    const p = await fixture('versions');
    const at = (...files: string[]) => Object.fromEntries(techVersionsForFiles(p, files));
    expect(at('apps/web/app/page.tsx')).toMatchObject({
      'framework.nextjs': '15.0.3',
      'framework.react': '19.0.0',
      'lang.typescript': '5.6.3',
      'runtime.node': '22',
      'db.postgresql': '16.4',
    });
    expect(at('apps/legacy/pages/index.js')).toMatchObject({
      'framework.nextjs': '13.5.6',
      'framework.react': '18.3.1',
      'lang.typescript': '5.6.2', // hoisted from the workspace root
      'runtime.node': '18',
    });
    const both = at('apps/web/app/page.tsx', 'apps/legacy/pages/index.js');
    for (const id of ['framework.nextjs', 'framework.react', 'lang.typescript', 'runtime.node'])
      expect(both[id], id).toBeUndefined();
    expect(both['db.postgresql']).toBe('16.4');
    expect(at('services/billing/main.go')).toMatchObject({ 'lang.go': '1.21', 'framework.gin': '1.9.1' });
    expect(at('services/search/main.go')).toMatchObject({ 'lang.go': '1.23.2', 'framework.echo': '4.12.0' });
    expect(at('services/search/main.go')['framework.gin']).toBeUndefined();
    const go = at('services/billing/main.go', 'services/search/main.go');
    expect(go['lang.go']).toBeUndefined();
    expect(go['framework.gin']).toBe('1.9.1'); // applies to one of the files only
    expect(at('./services/orders/src/main/java/com/acme/orders/OrdersApplication.java')).toMatchObject({
      'framework.spring': '3.3.4',
      'lang.java': '21',
    });
    expect(at('services/inventory/src/main/kotlin/com/acme/inventory/App.kt')).toMatchObject({
      'framework.spring': '3.2.5',
      'lang.kotlin': '1.9.24',
    });
    expect(at('services/gateway/Program.cs')).toMatchObject({
      'framework.aspnet': '8.0',
      'lang.csharp': '8.0',
      'orm.efcore': '8.0.10',
    });
    expect(at('services/admin/config/routes.rb')).toMatchObject({
      'framework.rails': '7.1',
      'lang.ruby': '3.3.5',
    });
    expect(at('tools/deno-fn/main.ts')['runtime.deno']).toBe('2.0.6');
    expect(at('tools/bun-worker/index.ts')['runtime.bun']).toBe('1.1.30');
    expect(at()).toEqual({});
    // techsForFile keeps working
    expect(techsForFile(p, 'apps/web/app/page.tsx').has('framework.nextjs')).toBe(true);
  });

  it('lockfile versions are a fallback; Dockerfile ARG defaults and codename tags resolve', async () => {
    const root = tempDir({
      Gemfile: 'gem "rails"\n',
      'Gemfile.lock':
        'GEM\n  remote: https://rubygems.org/\n  specs:\n    rails (7.2.1)\n\nRUBY VERSION\n   ruby 3.3.4p94\n',
      'svc/package.json': JSON.stringify({ dependencies: { express: '^4.21.0' } }),
      'svc/Dockerfile': `ARG BASE=node\nARG TAG="iron"\nFROM --platform=$BUILDPLATFORM ${ref('BASE')}:${ref('TAG')}-alpine AS deps\nARG TAG=ignored\nFROM deps\n`,
    });
    const p = await detectStack({ root });
    expect(version(p, 'framework.rails')).toBe('7.2.1');
    expect(version(p, 'lang.ruby')).toBe('3.3.4');
    expect(p.techs.find((t) => t.id === 'framework.rails')!.reasons.at(-1)).toBe(
      'version 7.2.1 (rails in Gemfile.lock)',
    );
    expect(version(p, 'framework.express')).toBe('4.21.0');
    expect(version(p, 'runtime.node')).toBe('20'); // node:iron-alpine
    expect(pkg(p, 'svc')!.techs).toContain('runtime.node'); // express runs on Node.js
  });

  it('Maven modules inherit the root version; runtime detection weights', async () => {
    const root = tempDir({
      'pom.xml':
        '<project><properties><maven.compiler.release>21</maven.compiler.release></properties><modules><module>a</module><module>b</module></modules></project>',
      'a/pom.xml': '<project><artifactId>a</artifactId></project>',
      'a/src/main/java/A.java': 'class A {}\n',
      'b/pom.xml': '<project><properties><java.version>17</java.version></properties></project>',
      'b/src/main/java/B.java': 'class B {}\n',
      'types-only/package.json': JSON.stringify({ devDependencies: { '@types/node': '^22.0.0' } }),
      'engines/package.json': JSON.stringify({ engines: { node: '>=20' } }),
      'bun/package.json': '{}',
      'bun/bun.lockb': '',
      'deno/deno.jsonc': '{}\n',
    });
    const p = await detectStack({ root });
    expect(Object.fromEntries(techVersionsForFiles(p, ['a/src/main/java/A.java']))['lang.java']).toBe('21');
    expect(Object.fromEntries(techVersionsForFiles(p, ['b/src/main/java/B.java']))['lang.java']).toBe('17');
    expect(
      techVersionsForFiles(p, ['a/src/main/java/A.java', 'b/src/main/java/B.java']).has('lang.java'),
    ).toBe(false);
    expect(pkg(p, 'types-only')!.techs).not.toContain('runtime.node'); // @types/node alone is weak
    expect(pkg(p, 'engines')!.techs).toContain('runtime.node');
    expect(pkg(p, 'bun')!.techs).toContain('runtime.bun');
    expect(pkg(p, 'deno')!.techs).toContain('runtime.deno');
  });

  it('parses hostile manifests in linear time', () => {
    const cases: Array<[FileKind, string, string]> = [
      ['gradle', 'build.gradle', `id 'x'${' '.repeat(1_990)}v\n`.repeat(100)],
      ['gradle', 'build.gradle', `sourceCompatibility${' '.repeat(1_980)}x\n`.repeat(100)],
      ['pom', 'pom.xml', `<properties>${'<a'.repeat(100_000)}</properties>`],
      ['pom', 'pom.xml', `<properties>${'<abc>'.repeat(40_000)}</properties>`],
      ['csproj', 'x.csproj', '<PackageReference '.repeat(12_000)],
      ['csproj', 'x.csproj', `<TargetFramework ${'a'.repeat(250_000)}`],
      ['requirements', 'requirements.txt', `django${'['.repeat(1_990)}\n`.repeat(100)],
      ['gemfile', 'Gemfile', `gem "rails"${', "1"'.repeat(400)}\n`.repeat(100)],
      ['gemfile-lock', 'Gemfile.lock', `GEM\n  specs:\n${'    a (1)\n'.repeat(20_000)}`],
      ['tool-versions', '.tool-versions', `nodejs ${'1 '.repeat(999)}\n`.repeat(200)],
      ['version-file', 'rust-toolchain', `${' '.repeat(200_000)}\n`],
    ];
    for (const [kind, file, text] of cases) {
      const t0 = performance.now();
      parseManifest(kind, file, text);
      expect(performance.now() - t0, `${kind} ${file}`).toBeLessThan(150);
    }
    const t0 = performance.now();
    for (let i = 0; i < 2_000; i++) specVersion(`${'1.'.repeat(60)}${'a-'.repeat(20)}`);
    expect(performance.now() - t0).toBeLessThan(150);
  });
});

describe('git mode', () => {
  it('reads contents at the commit, not the working tree, and skips committed symlinks', async () => {
    const repo = makeRepo();
    const outside = tempDir({ 'compose.yml': 'services:\n  db:\n    image: mongo:8\n' });
    try {
      repo.write({
        'package.json': JSON.stringify({ dependencies: { pg: '8', express: '5' } }),
        'src/app.ts': 'export {};\n',
        'db/schema.prisma': 'datasource db {\n  provider = "sqlserver"\n}\n',
      });
      symlinkSync(path.join(outside, 'compose.yml'), path.join(repo.root, 'docker-compose.yml'));
      const sha = repo.commit('init');
      // The working tree now differs from the commit: one manifest changed, one config deleted.
      repo.write({ 'package.json': JSON.stringify({ dependencies: { mysql2: '3' } }) });
      rmSync(path.join(repo.root, 'db'), { recursive: true });
      const git = new GitRepo(repo.root);

      const atSha = await detectStack({ root: repo.root, repo: git, sha });
      expect(score(atSha, 'db.postgresql')).toBeGreaterThanOrEqual(0.9);
      expect(score(atSha, 'framework.express')).toBeGreaterThanOrEqual(0.9);
      expect(version(atSha, 'framework.express')).toBe('5');
      expect(score(atSha, 'db.sqlserver')).toBeGreaterThanOrEqual(0.9); // only in the commit
      expect(score(atSha, 'db.mysql')).toBe(0);
      expect(score(atSha, 'db.mongodb')).toBe(0);
      expect(atSha.filesScanned).toBe(3); // the symlink is not listed
      expect(atSha.filesRead).toBe(2);

      // A caller-supplied list restricts the tree listing.
      const restricted = await detectStack({ root: repo.root, repo: git, sha, files: ['package.json'] });
      expect(restricted.filesScanned).toBe(1);
      expect(score(restricted, 'db.sqlserver')).toBe(0);

      const worktree = await detectStack({ root: repo.root, repo: git });
      expect(score(worktree, 'db.mysql')).toBeGreaterThanOrEqual(0.9);
      expect(score(worktree, 'db.sqlserver')).toBe(0);
      expect(score(worktree, 'db.mongodb')).toBe(0);

      await expect(detectStack({ root: repo.root, repo: git, sha: '--output=/tmp/x' })).rejects.toThrow();
    } finally {
      repo.cleanup();
    }
  });

  it('honours an abort signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(detectStack({ root: FIXTURES, signal: ac.signal })).rejects.toThrow();
  });
});
