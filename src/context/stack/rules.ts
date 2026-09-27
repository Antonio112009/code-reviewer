import type { TechId } from './techs';

/**
 * Declarative technology-detection rules. Dependency names are seeded from @specfy/stack-analyser
 * (MIT) and marker-file patterns from @vercel/frameworks (Apache-2.0), then extended with JVM, .NET,
 * config-content and service-image signals.
 *
 * Every regex here is evaluated against short, bounded strings (dependency names, base names, single
 * lines truncated to 2,000 chars) and is written without nested quantifiers, so matching stays linear.
 */

/** Package ecosystems whose manifests we parse. */
export type Eco = 'npm' | 'pypi' | 'go' | 'cargo' | 'maven' | 'nuget' | 'composer' | 'gem' | 'pub' | 'hex';

export type Signal =
  /** Dependency in a manifest; `wDev` applies to dev/peer/test scopes (default min(w, 0.5)). */
  | { k: 'dep'; eco: Eco; name: string | RegExp; w: number; wDev?: number }
  /** A file whose base name equals / matches `name`, optionally only inside a directory matching `dir`. */
  | { k: 'file'; name: string | RegExp; dir?: RegExp; w: number }
  /** Files with this extension (lowercase, with dot); counted once per package. */
  | { k: 'ext'; ext: string; w: number }
  /** A directory (repo-relative, posix) matching `re`. */
  | { k: 'dir'; re: RegExp; w: number }
  /** Container image (registry and tag stripped); the weight comes from where it was found. */
  | { k: 'image'; re: RegExp }
  /** URL scheme (`postgres://`, `redis://`, …) in env/config files; weight from the file kind. */
  | { k: 'scheme'; names: string[] }
  /** Key prefix in `.env.example`-style files (values are never kept). */
  | { k: 'env'; prefixes: string[]; w: number };

export interface Rule {
  id: TechId;
  /** Techs implied by this one (e.g. Next.js → React), at the same score. */
  implies?: TechId[];
  signals: Signal[];
}

/** File kinds we are willing to open (everything else is only looked at by name). */
export type FileKind =
  | 'gitattributes'
  | 'npm'
  | 'pnpm-workspace'
  | 'pyproject'
  | 'requirements'
  | 'pipfile'
  | 'gomod'
  | 'gowork'
  | 'cargo'
  | 'pom'
  | 'gradle'
  | 'gradle-settings'
  | 'gradle-catalog'
  | 'csproj'
  | 'nuget-props'
  | 'composer'
  | 'gemfile'
  | 'pubspec'
  | 'mix'
  | 'env'
  | 'compose'
  | 'github-workflow'
  | 'ci'
  | 'prisma'
  | 'drizzle'
  | 'typeorm'
  | 'knex'
  | 'sequelize'
  | 'django-settings'
  | 'alembic'
  | 'spring-config'
  | 'rails-db'
  | 'laravel-db'
  | 'dotnet-code'
  | 'appsettings'
  | 'chart'
  | 'dockerfile'
  | 'sam'
  | 'k8s'
  | 'terraform'
  | 'sql'
  /** `.nvmrc`, `.node-version`, `.python-version`, `runtime.txt`, `.ruby-version`, `rust-toolchain`, … */
  | 'version-file'
  /** asdf / mise `.tool-versions` */
  | 'tool-versions'
  /** `Package.swift` (only its first line: `// swift-tools-version:5.9`) */
  | 'swift-package'
  | 'gemfile-lock';

/** A regex applied to every (truncated) line of files of the given kinds. */
export interface TextRule {
  kinds: FileKind[];
  re: RegExp;
  /** Fixed tech, or lowercase capture group 1 → tech (values missing from the map are ignored). */
  map: TechId | Record<string, TechId>;
  w: number;
  /** Human label used in reasons, e.g. "Prisma datasource provider". */
  what: string;
}

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

type Name = string | RegExp;
const dep =
  (eco: Eco) =>
  (names: Name | Name[], w = 0.9, wDev?: number): Signal[] =>
    (Array.isArray(names) ? names : [names]).map((name) => ({ k: 'dep', eco, name, w, wDev }));
const npm = dep('npm');
const pypi = dep('pypi');
const gomod = dep('go');
const cargo = dep('cargo');
const maven = dep('maven');
const nuget = dep('nuget');
const composer = dep('composer');
const gem = dep('gem');
const pub = dep('pub');
const hex = dep('hex');
const file = (name: Name, w: number, dir?: RegExp): Signal => ({ k: 'file', name, w, dir });
const ext = (e: string, w: number): Signal => ({ k: 'ext', ext: e, w });
const dir = (re: RegExp, w: number): Signal => ({ k: 'dir', re, w });
const image = (re: RegExp): Signal => ({ k: 'image', re });
const scheme = (...names: string[]): Signal => ({ k: 'scheme', names });
const env = (w: number, ...prefixes: string[]): Signal => ({ k: 'env', prefixes, w });

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const RULES: Rule[] = [
  // ----- languages (file-extension share is added by the engine) -----
  { id: 'lang.javascript', signals: [file('jsconfig.json', 0.6)] },
  {
    id: 'lang.typescript',
    signals: [
      file('tsconfig.json', 0.7),
      file(/^tsconfig\.[\w.-]+\.json$/, 0.5),
      ...npm('typescript', 0.7, 0.7),
    ],
  },
  {
    id: 'lang.python',
    signals: [
      file('pyproject.toml', 0.8),
      file('setup.py', 0.7),
      file('Pipfile', 0.8),
      file(/^(?:[\w-]+[-_.])?requirements(?:[-_.][\w.-]+)?\.(?:txt|in)$/, 0.7),
      file('uv.lock', 0.7),
      file('poetry.lock', 0.7),
      file('.python-version', 0.6),
    ],
  },
  { id: 'lang.php', signals: [file('composer.json', 0.8)] },
  { id: 'lang.java', signals: [file('pom.xml', 0.5), file('mvnw', 0.4), file('build.gradle', 0.4)] },
  {
    id: 'lang.kotlin',
    signals: [
      file('build.gradle.kts', 0.5),
      ...maven(/^org\.jetbrains\.kotlin:kotlin-stdlib/, 0.8),
      ...maven(/^plugin:org\.jetbrains\.kotlin\.[\w.-]+$/, 0.9),
    ],
  },
  { id: 'lang.csharp', signals: [ext('.csproj', 0.9), ext('.sln', 0.6)] },
  { id: 'lang.go', signals: [file('go.mod', 0.9), file('go.work', 0.8)] },
  { id: 'lang.rust', signals: [file('Cargo.toml', 0.9), file(/^rust-toolchain(?:\.toml)?$/, 0.7)] },
  { id: 'lang.c', signals: [file('meson.build', 0.4)] },
  {
    id: 'lang.cpp',
    signals: [file('CMakeLists.txt', 0.4), file('conanfile.txt', 0.7), file('vcpkg.json', 0.7)],
  },
  {
    id: 'lang.ruby',
    signals: [file('Gemfile', 0.8), file('.ruby-version', 0.6), file('Rakefile', 0.5), ext('.gemspec', 0.8)],
  },
  { id: 'lang.swift', signals: [file('Package.swift', 0.9)] },
  { id: 'lang.scala', signals: [file('build.sbt', 0.9)] },
  { id: 'lang.dart', signals: [file('pubspec.yaml', 0.9)] },
  { id: 'lang.elixir', signals: [file('mix.exs', 0.9)] },
  { id: 'lang.sql', signals: [file(/^V\d+(?:_\d+)*__[\w-]+\.sql$/, 0.5), file(/\.up\.sql$/, 0.5)] },

  // ----- runtimes (package.json fields are pseudo-dependencies: `engines:node`, `packageManager:bun`, …) -----
  {
    id: 'runtime.node',
    signals: [
      file('.nvmrc', 0.7),
      file('.node-version', 0.7),
      ...npm(['engines:node', 'volta:node', 'devEngines:node'], 0.7),
      // server-side frameworks and adapters run on Node.js
      ...npm(['express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi', '@hono/node-server'], 0.85),
      ...npm(['@remix-run/node', '@react-router/node', '@react-router/serve'], 0.8),
      ...npm(['@sveltejs/adapter-node', '@astrojs/node', 'pm2'], 0.8),
      ...npm(['next', 'nuxt', 'electron', 'nodemon'], 0.6, 0.6),
      // present in most TypeScript projects, browser-only ones included: weak on its own
      ...npm('@types/node', 0.4, 0.4),
      image(/(?:^|\/)node$/),
    ],
  },
  {
    id: 'runtime.deno',
    signals: [
      file('deno.json', 0.9),
      file('deno.jsonc', 0.9),
      file('deno.lock', 0.8),
      ...npm(['engines:deno', 'devEngines:deno'], 0.8),
      image(/^denoland\/deno$/),
    ],
  },
  {
    id: 'runtime.bun',
    signals: [
      file('bun.lock', 0.9),
      file('bun.lockb', 0.9),
      file('bunfig.toml', 0.9),
      file('.bun-version', 0.8),
      ...npm(['packageManager:bun', 'engines:bun', 'devEngines:bun'], 0.9, 0.9),
      ...npm(['@types/bun', 'bun-types'], 0.6, 0.6),
      image(/^oven\/bun$/),
    ],
  },

  // ----- frontend / mobile / desktop -----
  {
    id: 'framework.react',
    signals: [
      ...npm('react', 0.9),
      ...npm('react-dom', 0.8),
      ...npm('@vitejs/plugin-react', 0.6, 0.6),
      ext('.tsx', 0.35),
      ext('.jsx', 0.35),
    ],
  },
  {
    id: 'framework.nextjs',
    implies: ['framework.react'],
    signals: [...npm('next', 0.95), file(/^next\.config\.(?:js|mjs|cjs|ts|mts)$/, 0.7)],
  },
  {
    id: 'framework.remix',
    implies: ['framework.react'],
    signals: [
      ...npm(['@remix-run/react', '@remix-run/node'], 0.9),
      ...npm('@react-router/dev', 0.9, 0.9),
      file(/^remix\.config\.(?:js|mjs|cjs|ts)$/, 0.7),
      file(/^react-router\.config\.(?:js|mjs|ts)$/, 0.8),
    ],
  },
  {
    id: 'framework.vue',
    signals: [
      ...npm('vue', 0.9),
      ...npm('@vitejs/plugin-vue', 0.7, 0.7),
      ext('.vue', 0.7),
      file(/^vue\.config\.(?:js|ts)$/, 0.6),
    ],
  },
  {
    id: 'framework.nuxt',
    implies: ['framework.vue'],
    signals: [...npm('nuxt', 0.95, 0.9), file(/^nuxt\.config\.(?:js|mjs|ts)$/, 0.7)],
  },
  {
    id: 'framework.angular',
    signals: [...npm('@angular/core', 0.95), ...npm('@angular/cli', 0.6, 0.6), file('angular.json', 0.8)],
  },
  {
    id: 'framework.svelte',
    signals: [
      ...npm('svelte', 0.9, 0.8),
      ...npm('@sveltejs/kit', 0.95, 0.9),
      ext('.svelte', 0.7),
      file(/^svelte\.config\.(?:js|mjs|ts)$/, 0.7),
    ],
  },
  {
    id: 'framework.astro',
    signals: [
      ...npm('astro', 0.95, 0.9),
      ext('.astro', 0.8),
      file(/^astro\.config\.(?:js|mjs|ts|mts)$/, 0.7),
    ],
  },
  { id: 'framework.solid', signals: [...npm('solid-js', 0.9), ...npm('@solidjs/start', 0.95)] },
  {
    id: 'framework.react-native',
    implies: ['framework.react'],
    signals: [...npm('react-native', 0.95), ...npm('expo', 0.9), file(/^metro\.config\.(?:js|cjs|ts)$/, 0.6)],
  },
  { id: 'framework.flutter', implies: ['lang.dart'], signals: [...pub('flutter', 0.95)] },
  {
    id: 'framework.electron',
    signals: [
      ...npm('electron', 0.9, 0.9),
      ...npm(['electron-builder', '@electron-forge/cli'], 0.7, 0.7),
      file(/^electron-builder\.(?:ya?ml|json)$/, 0.6),
      file(/^forge\.config\.(?:js|cjs|ts)$/, 0.6),
    ],
  },
  {
    id: 'framework.android',
    signals: [
      file('AndroidManifest.xml', 0.9),
      ...maven(['plugin:com.android.application', 'plugin:com.android.library'], 0.95),
      ...maven(/^androidx\.[\w.-]+:[\w.-]+$/, 0.7),
    ],
  },
  {
    id: 'framework.ios',
    signals: [
      dir(/\.xcodeproj$/, 0.8),
      dir(/\.xcworkspace$/, 0.7),
      file('Podfile', 0.6),
      ext('.storyboard', 0.8),
      ext('.xib', 0.7),
    ],
  },

  // ----- backend (JS) -----
  { id: 'framework.express', signals: [...npm('express', 0.9), ...npm('@nestjs/platform-express', 0.6)] },
  { id: 'framework.fastify', signals: [...npm('fastify', 0.9), ...npm('@nestjs/platform-fastify', 0.7)] },
  { id: 'framework.koa', signals: [...npm('koa', 0.9), ...npm('@koa/router', 0.7)] },
  { id: 'framework.hono', signals: [...npm('hono', 0.9)] },
  {
    id: 'framework.nestjs',
    signals: [...npm('@nestjs/core', 0.95), ...npm('@nestjs/common', 0.9), file('nest-cli.json', 0.7)],
  },
  {
    id: 'framework.trpc',
    signals: [...npm('@trpc/server', 0.9), ...npm(['@trpc/client', '@trpc/react-query'], 0.8)],
  },
  {
    id: 'framework.graphql',
    signals: [
      ...npm('graphql', 0.8),
      ...npm(
        ['@apollo/server', 'apollo-server', 'apollo-server-express', 'graphql-yoga', 'type-graphql'],
        0.9,
      ),
      ...npm(['@nestjs/graphql', 'mercurius', '@pothos/core'], 0.9),
      ...npm(['@apollo/client', 'urql', '@urql/core', 'graphql-request'], 0.8),
      ...pypi(['graphene', 'graphene-django', 'strawberry-graphql', 'ariadne'], 0.9),
      ...gomod(['github.com/99designs/gqlgen', 'github.com/graphql-go/graphql'], 0.9),
      ...maven(
        ['com.graphql-java:graphql-java', 'org.springframework.boot:spring-boot-starter-graphql'],
        0.9,
      ),
      ...nuget([/^HotChocolate\.[\w.]+$/, 'GraphQL'], 0.9),
      ...gem('graphql', 0.9),
      ...cargo(['async-graphql', 'juniper'], 0.9),
      ...composer(['webonyx/graphql-php', 'nuwave/lighthouse'], 0.9),
      ext('.graphql', 0.6),
      ext('.gql', 0.6),
    ],
  },

  // ----- backend (Python) -----
  {
    id: 'framework.django',
    implies: ['orm.django'],
    signals: [...pypi('django', 0.95), ...pypi('djangorestframework', 0.8), file('manage.py', 0.6)],
  },
  { id: 'framework.flask', signals: [...pypi('flask', 0.95)] },
  { id: 'framework.fastapi', signals: [...pypi('fastapi', 0.95)] },
  { id: 'framework.celery', signals: [...pypi('celery', 0.9), file('celeryconfig.py', 0.6)] },

  // ----- backend (JVM / PHP / Ruby / .NET / Go / Rust) -----
  {
    id: 'framework.spring',
    signals: [
      ...maven(/^org\.springframework\.boot:[\w.-]+$/, 0.95),
      ...maven(/^org\.springframework(?:\.cloud)?:[\w.-]+$/, 0.8),
      ...maven(['plugin:org.springframework.boot', 'plugin:io.spring.dependency-management'], 0.9),
      file(
        /^(?:application|bootstrap)(?:-[\w]+)?\.(?:properties|ya?ml)$/,
        0.4,
        /(?:^|\/)src\/main\/resources$/,
      ),
    ],
  },
  {
    id: 'framework.quarkus',
    signals: [...maven(/^io\.quarkus(?:\.platform)?:[\w.-]+$/, 0.95), ...maven('plugin:io.quarkus', 0.95)],
  },
  {
    id: 'framework.laravel',
    implies: ['orm.eloquent'],
    signals: [
      ...composer('laravel/framework', 0.95),
      ...composer('laravel/lumen-framework', 0.9),
      file('artisan', 0.7),
      file(/\.blade\.php$/, 0.7),
    ],
  },
  {
    id: 'framework.symfony',
    signals: [
      ...composer('symfony/framework-bundle', 0.95),
      ...composer(/^symfony\/[\w.-]+$/, 0.5),
      file('symfony.lock', 0.8),
      ext('.twig', 0.4),
    ],
  },
  {
    id: 'framework.rails',
    implies: ['orm.activerecord'],
    signals: [
      ...gem('rails', 0.95),
      ...gem('railties', 0.9),
      file('routes.rb', 0.6, /(?:^|\/)config$/),
      file('rails', 0.7, /(?:^|\/)bin$/),
      ext('.erb', 0.4),
    ],
  },
  {
    id: 'framework.aspnet',
    signals: [
      ...nuget('sdk:Microsoft.NET.Sdk.Web', 0.95),
      ...nuget(['sdk:Microsoft.NET.Sdk.BlazorWebAssembly', 'sdk:Microsoft.NET.Sdk.Razor'], 0.8),
      ...nuget(/^Microsoft\.AspNetCore\.[\w.]+$/, 0.8),
      ext('.razor', 0.6),
      ext('.cshtml', 0.6),
      file(/^appsettings(?:\.[\w-]+)?\.json$/, 0.5),
    ],
  },
  { id: 'framework.gin', signals: [...gomod('github.com/gin-gonic/gin', 0.95)] },
  { id: 'framework.echo', signals: [...gomod('github.com/labstack/echo', 0.95)] },
  { id: 'framework.fiber', signals: [...gomod('github.com/gofiber/fiber', 0.95)] },
  { id: 'framework.chi', signals: [...gomod('github.com/go-chi/chi', 0.95)] },
  { id: 'framework.axum', signals: [...cargo('axum', 0.95)] },
  { id: 'framework.actix', signals: [...cargo('actix-web', 0.95)] },

  // ----- databases -----
  {
    id: 'db.postgresql',
    signals: [
      ...npm(['pg', 'postgres', 'pg-promise', '@neondatabase/serverless', '@vercel/postgres', 'slonik'], 0.9),
      ...npm(['pg-pool', '@electric-sql/pglite'], 0.7),
      ...pypi(['psycopg', 'psycopg2', 'psycopg2-binary', 'psycopg-binary', 'asyncpg', 'pg8000'], 0.9),
      ...gomod(['github.com/jackc/pgx', 'github.com/lib/pq', 'gorm.io/driver/postgres'], 0.9),
      ...cargo(
        ['tokio-postgres', 'postgres', 'deadpool-postgres', 'sqlx[postgres]', 'diesel[postgres]'],
        0.9,
      ),
      ...cargo('sea-orm[sqlx-postgres]', 0.9),
      ...maven(
        ['org.postgresql:postgresql', 'org.postgresql:r2dbc-postgresql', 'io.r2dbc:r2dbc-postgresql'],
        0.9,
      ),
      ...maven(['io.quarkus:quarkus-jdbc-postgresql', 'io.quarkus:quarkus-reactive-pg-client'], 0.9),
      ...maven(['org.flywaydb:flyway-database-postgresql', 'org.testcontainers:postgresql'], 0.7),
      ...nuget(['Npgsql', 'Npgsql.EntityFrameworkCore.PostgreSQL'], 0.9),
      ...composer(['ext-pgsql', 'ext-pdo_pgsql'], 0.9),
      ...gem(['pg', 'activerecord-postgis-adapter'], 0.9),
      ...pub('postgres', 0.8),
      ...hex('postgrex', 0.9),
      image(/(?:^|\/)(?:postgres|postgresql|postgis|pgvector|timescaledb|timescaledb-ha|pgbouncer)$/),
      scheme('postgres', 'postgresql', 'postgis', 'pgsql'),
      env(0.4, 'POSTGRES_', 'PGHOST', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'PGPORT'),
    ],
  },
  {
    id: 'db.mysql',
    signals: [
      ...npm(['mysql', 'mysql2', 'mariadb', '@planetscale/database'], 0.9),
      ...pypi(['pymysql', 'mysqlclient', 'mysql-connector-python', 'aiomysql', 'asyncmy'], 0.9),
      ...gomod(['github.com/go-sql-driver/mysql', 'gorm.io/driver/mysql'], 0.9),
      ...cargo(['mysql', 'mysql_async', 'sqlx[mysql]', 'diesel[mysql]'], 0.9),
      ...maven(['com.mysql:mysql-connector-j', 'mysql:mysql-connector-java'], 0.9),
      ...maven(['org.mariadb.jdbc:mariadb-java-client', 'io.quarkus:quarkus-jdbc-mysql'], 0.9),
      ...maven(
        ['io.quarkus:quarkus-jdbc-mariadb', 'org.flywaydb:flyway-mysql', 'org.testcontainers:mysql'],
        0.7,
      ),
      ...nuget(
        ['MySql.Data', 'MySqlConnector', 'Pomelo.EntityFrameworkCore.MySql', 'MySql.EntityFrameworkCore'],
        0.9,
      ),
      ...composer(['ext-pdo_mysql', 'ext-mysqli'], 0.9),
      ...gem(['mysql2', 'trilogy'], 0.9),
      ...hex('myxql', 0.9),
      image(/(?:^|\/)(?:mysql|mysql-server|mariadb|percona|percona-server)$/),
      scheme('mysql', 'mysqlx', 'mariadb'),
      env(0.4, 'MYSQL_', 'MARIADB_'),
    ],
  },
  {
    id: 'db.sqlite',
    signals: [
      ...npm(['better-sqlite3', 'sqlite3', 'sqlite', '@libsql/client', 'sql.js'], 0.9),
      ...pypi(['aiosqlite', 'sqlite-utils'], 0.8),
      ...gomod(['github.com/mattn/go-sqlite3', 'modernc.org/sqlite', 'gorm.io/driver/sqlite'], 0.9),
      ...gomod('github.com/glebarez/sqlite', 0.9),
      ...cargo(['rusqlite', 'libsql', 'sqlx[sqlite]', 'diesel[sqlite]'], 0.9),
      ...maven('org.xerial:sqlite-jdbc', 0.9),
      ...nuget(['Microsoft.Data.Sqlite', 'Microsoft.EntityFrameworkCore.Sqlite', 'System.Data.SQLite'], 0.9),
      ...nuget('sqlite-net-pcl', 0.9),
      ...composer(['ext-pdo_sqlite', 'ext-sqlite3'], 0.8),
      ...gem('sqlite3', 0.9),
      ...pub(['sqflite', 'sqlite3', 'drift'], 0.9),
      ...hex(['exqlite', 'ecto_sqlite3'], 0.9),
      scheme('sqlite', 'sqlite3', 'libsql'),
      ext('.sqlite', 0.4),
      ext('.sqlite3', 0.4),
    ],
  },
  {
    id: 'db.sqlserver',
    signals: [
      ...npm(['mssql', 'tedious'], 0.9),
      ...pypi(['pymssql', 'mssql-django'], 0.9),
      ...pypi('pyodbc', 0.5),
      ...gomod(['github.com/microsoft/go-mssqldb', 'github.com/denisenkom/go-mssqldb'], 0.9),
      ...gomod('gorm.io/driver/sqlserver', 0.9),
      ...cargo('tiberius', 0.9),
      ...maven(['com.microsoft.sqlserver:mssql-jdbc', 'io.quarkus:quarkus-jdbc-mssql'], 0.9),
      ...nuget(
        ['Microsoft.Data.SqlClient', 'System.Data.SqlClient', 'Microsoft.EntityFrameworkCore.SqlServer'],
        0.9,
      ),
      ...composer(['ext-sqlsrv', 'ext-pdo_sqlsrv'], 0.9),
      ...gem(['tiny_tds', 'activerecord-sqlserver-adapter'], 0.9),
      image(/(?:^|\/)(?:mssql\/server|mssql-server-linux|azure-sql-edge)$/),
      scheme('sqlserver', 'mssql'),
      env(0.4, 'MSSQL_', 'SQLSERVER_'),
    ],
  },
  {
    id: 'db.oracle',
    signals: [
      ...npm('oracledb', 0.9),
      ...pypi(['cx-oracle', 'oracledb'], 0.9),
      ...gomod(['github.com/godror/godror', 'github.com/sijms/go-ora'], 0.9),
      ...maven(/^com\.oracle\.database\.jdbc:ojdbc\d*$/, 0.9),
      ...nuget(
        ['Oracle.ManagedDataAccess.Core', 'Oracle.ManagedDataAccess', 'Oracle.EntityFrameworkCore'],
        0.9,
      ),
      ...composer('ext-oci8', 0.9),
      ...gem(['ruby-oci8', 'activerecord-oracle_enhanced-adapter'], 0.9),
      image(/(?:^|\/)(?:oracle-xe|oracle-free|database\/free|database\/express|database\/enterprise)$/),
      scheme('oracle'),
    ],
  },
  {
    id: 'db.mongodb',
    signals: [
      ...npm(['mongodb', 'mongoose', '@nestjs/mongoose'], 0.9),
      ...npm('@typegoose/typegoose', 0.8),
      ...npm('mongodb-memory-server', 0.5),
      ...pypi(['pymongo', 'motor', 'mongoengine', 'beanie', 'odmantic', 'djongo'], 0.9),
      ...gomod('go.mongodb.org/mongo-driver', 0.9),
      ...cargo('mongodb', 0.9),
      ...maven(/^org\.mongodb:[\w.-]+$/, 0.9),
      ...maven(
        ['org.springframework.boot:spring-boot-starter-data-mongodb', 'io.quarkus:quarkus-mongodb-client'],
        0.9,
      ),
      ...nuget(['MongoDB.Driver', 'MongoDB.EntityFrameworkCore'], 0.9),
      ...composer(['mongodb/mongodb', 'mongodb/laravel-mongodb', 'jenssegers/mongodb', 'ext-mongodb'], 0.9),
      ...composer('doctrine/mongodb-odm', 0.9),
      ...gem(['mongoid', 'mongo'], 0.9),
      ...hex('mongodb_driver', 0.9),
      image(/(?:^|\/)(?:mongo|mongodb|mongodb-community-server|mongodb-enterprise-server)$/),
      scheme('mongodb'),
      env(0.4, 'MONGO_', 'MONGODB_'),
    ],
  },
  {
    id: 'db.redis',
    signals: [
      ...npm(
        ['redis', 'ioredis', '@redis/client', '@upstash/redis', 'iovalkey', '@valkey/valkey-glide'],
        0.9,
      ),
      ...npm(['connect-redis', 'cache-manager-redis-store', '@keyv/redis'], 0.8),
      ...npm(['bullmq', 'bull'], 0.6),
      ...pypi(['redis', 'aioredis', 'django-redis', 'channels-redis', 'valkey'], 0.9),
      ...pypi(['rq', 'hiredis'], 0.6),
      ...gomod(['github.com/redis/go-redis', 'github.com/go-redis/redis', 'github.com/gomodule/redigo'], 0.9),
      ...gomod(['github.com/redis/rueidis', 'github.com/valkey-io/valkey-go'], 0.9),
      ...cargo(['redis', 'fred', 'deadpool-redis', 'bb8-redis'], 0.9),
      ...maven(['redis.clients:jedis', 'io.lettuce:lettuce-core', 'org.redisson:redisson'], 0.9),
      ...maven(
        ['org.springframework.boot:spring-boot-starter-data-redis', 'io.quarkus:quarkus-redis-client'],
        0.9,
      ),
      ...nuget(['StackExchange.Redis', 'Microsoft.Extensions.Caching.StackExchangeRedis'], 0.9),
      ...composer(['predis/predis', 'ext-redis'], 0.9),
      ...gem(['redis', 'redis-client', 'hiredis'], 0.9),
      ...gem(['sidekiq', 'resque'], 0.7),
      ...hex('redix', 0.9),
      image(/(?:^|\/)(?:redis|valkey|redis-stack|redis-stack-server|keydb|dragonfly)$/),
      scheme('redis', 'rediss', 'valkey', 'valkeys'),
      env(0.4, 'REDIS_', 'VALKEY_', 'UPSTASH_REDIS_'),
    ],
  },
  {
    id: 'db.elasticsearch',
    signals: [
      ...npm(['@elastic/elasticsearch', '@opensearch-project/opensearch', 'elasticsearch'], 0.9),
      ...pypi(['elasticsearch', 'elasticsearch-dsl', 'opensearch-py'], 0.9),
      ...gomod(['github.com/elastic/go-elasticsearch', 'github.com/olivere/elastic'], 0.9),
      ...gomod('github.com/opensearch-project/opensearch-go', 0.9),
      ...cargo(['elasticsearch', 'opensearch'], 0.9),
      ...maven(
        ['co.elastic.clients:elasticsearch-java', /^org\.(?:elasticsearch|opensearch)\.client:[\w.-]+$/],
        0.9,
      ),
      ...maven('org.springframework.boot:spring-boot-starter-data-elasticsearch', 0.9),
      ...nuget(['Elastic.Clients.Elasticsearch', 'NEST', 'OpenSearch.Client'], 0.9),
      ...composer(['elasticsearch/elasticsearch', 'opensearch-project/opensearch-php'], 0.9),
      ...gem(['elasticsearch', 'searchkick', 'opensearch-ruby', 'chewy'], 0.9),
      image(/(?:^|\/)(?:elasticsearch|opensearch)$/),
      env(0.4, 'ELASTICSEARCH_', 'ELASTIC_', 'OPENSEARCH_'),
    ],
  },
  {
    id: 'db.clickhouse',
    signals: [
      ...npm(['@clickhouse/client', '@clickhouse/client-web'], 0.9),
      ...pypi(['clickhouse-connect', 'clickhouse-driver'], 0.9),
      ...gomod('github.com/ClickHouse/clickhouse-go', 0.9),
      ...cargo('clickhouse', 0.9),
      ...maven(['com.clickhouse:clickhouse-jdbc', 'com.clickhouse:client-v2'], 0.9),
      ...nuget('ClickHouse.Client', 0.9),
      ...gem('clickhouse-activerecord', 0.9),
      image(/(?:^|\/)(?:clickhouse-server|clickhouse)$/),
      scheme('clickhouse'),
      env(0.4, 'CLICKHOUSE_'),
    ],
  },
  {
    id: 'db.cassandra',
    signals: [
      ...npm('cassandra-driver', 0.9),
      ...pypi(['cassandra-driver', 'scylla-driver'], 0.9),
      ...gomod(['github.com/gocql/gocql', 'github.com/scylladb/gocqlx'], 0.9),
      ...cargo(['scylla', 'cdrs-tokio'], 0.9),
      ...maven(
        [/^com\.datastax\.oss:[\w.-]+$/, 'org.springframework.boot:spring-boot-starter-data-cassandra'],
        0.9,
      ),
      ...nuget('CassandraCSharpDriver', 0.9),
      ...gem('cassandra-driver', 0.9),
      image(/(?:^|\/)(?:cassandra|scylla)$/),
      env(0.4, 'CASSANDRA_', 'SCYLLA_'),
    ],
  },
  {
    id: 'db.dynamodb',
    signals: [
      ...npm(
        ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', 'dynamoose', 'electrodb', 'dynamodb-toolbox'],
        0.9,
      ),
      ...pypi('pynamodb', 0.9),
      ...gomod(['github.com/aws/aws-sdk-go-v2/service/dynamodb', 'github.com/guregu/dynamo'], 0.9),
      ...cargo('aws-sdk-dynamodb', 0.9),
      ...maven(['software.amazon.awssdk:dynamodb', 'software.amazon.awssdk:dynamodb-enhanced'], 0.9),
      ...maven('com.amazonaws:aws-java-sdk-dynamodb', 0.9),
      ...nuget('AWSSDK.DynamoDBv2', 0.9),
      ...gem(['aws-sdk-dynamodb', 'dynamoid'], 0.9),
      image(/(?:^|\/)dynamodb-local$/),
      env(0.4, 'DYNAMODB_', 'DYNAMO_'),
    ],
  },
  {
    id: 'db.neo4j',
    signals: [
      ...npm('neo4j-driver', 0.9),
      ...pypi(['neo4j', 'py2neo', 'neomodel'], 0.9),
      ...gomod('github.com/neo4j/neo4j-go-driver', 0.9),
      ...cargo('neo4rs', 0.9),
      ...maven(
        ['org.neo4j.driver:neo4j-java-driver', 'org.springframework.boot:spring-boot-starter-data-neo4j'],
        0.9,
      ),
      ...nuget('Neo4j.Driver', 0.9),
      ...gem(['neo4j-ruby-driver', 'activegraph'], 0.9),
      image(/(?:^|\/)neo4j$/),
      scheme('neo4j', 'bolt'),
      env(0.4, 'NEO4J_'),
    ],
  },
  {
    id: 'db.cockroachdb',
    signals: [
      ...pypi(['sqlalchemy-cockroachdb', 'django-cockroachdb'], 0.9),
      ...gomod('github.com/cockroachdb/cockroach-go', 0.9),
      image(/(?:^|\/)cockroach$/),
      scheme('cockroachdb'),
      env(0.4, 'COCKROACH_'),
    ],
  },

  // ----- ORMs / data access -----
  {
    id: 'orm.prisma',
    signals: [
      ...npm('@prisma/client', 0.95),
      ...npm('prisma', 0.9, 0.9),
      ext('.prisma', 0.9),
      dir(/(?:^|\/)prisma\/migrations$/, 0.6),
    ],
  },
  {
    id: 'orm.typeorm',
    signals: [
      ...npm('typeorm', 0.95),
      ...npm('@nestjs/typeorm', 0.9),
      file(/^ormconfig\.(?:json|js|ts|ya?ml)$/, 0.8),
    ],
  },
  {
    id: 'orm.sequelize',
    signals: [
      ...npm(['sequelize', 'sequelize-typescript', '@nestjs/sequelize'], 0.9),
      file('.sequelizerc', 0.8),
    ],
  },
  {
    id: 'orm.drizzle',
    signals: [
      ...npm('drizzle-orm', 0.95),
      ...npm('drizzle-kit', 0.8, 0.8),
      file(/^drizzle\.config\.(?:js|mjs|cjs|ts|mts|json)$/, 0.8),
    ],
  },
  { id: 'orm.knex', signals: [...npm('knex', 0.9), file(/^knexfile\.(?:js|mjs|cjs|ts)$/, 0.8)] },
  {
    id: 'orm.mongoose',
    implies: ['db.mongodb'],
    signals: [...npm(['mongoose', '@nestjs/mongoose'], 0.95), ...npm('@typegoose/typegoose', 0.8)],
  },
  {
    id: 'orm.sqlalchemy',
    signals: [
      ...pypi(['sqlalchemy', 'flask-sqlalchemy', 'sqlmodel'], 0.95),
      ...pypi('alembic', 0.8),
      file('alembic.ini', 0.7),
    ],
  },
  { id: 'orm.django', signals: [file(/^\d{4}_\w+\.py$/, 0.5, /(?:^|\/)migrations$/)] },
  {
    id: 'orm.hibernate',
    signals: [
      ...maven(['org.hibernate:hibernate-core', 'org.hibernate.orm:hibernate-core'], 0.95),
      ...maven(
        ['org.springframework.boot:spring-boot-starter-data-jpa', 'io.quarkus:quarkus-hibernate-orm'],
        0.9,
      ),
      ...maven('io.quarkus:quarkus-hibernate-orm-panache', 0.9),
      ...maven(
        ['jakarta.persistence:jakarta.persistence-api', 'javax.persistence:javax.persistence-api'],
        0.8,
      ),
      file('persistence.xml', 0.7),
    ],
  },
  { id: 'orm.eloquent', signals: [...composer('illuminate/database', 0.9)] },
  {
    id: 'orm.doctrine',
    signals: [
      ...composer(['doctrine/orm', 'doctrine/doctrine-bundle'], 0.95),
      ...composer('doctrine/doctrine-migrations-bundle', 0.7),
      ...composer('doctrine/dbal', 0.6),
    ],
  },
  {
    id: 'orm.activerecord',
    signals: [
      ...gem('activerecord', 0.9),
      dir(/(?:^|\/)db\/migrate$/, 0.6),
      file('schema.rb', 0.7, /(?:^|\/)db$/),
    ],
  },
  {
    id: 'orm.efcore',
    signals: [
      ...nuget(/^Microsoft\.EntityFrameworkCore(?:\.[\w.]+)?$/, 0.95),
      ...nuget(['Npgsql.EntityFrameworkCore.PostgreSQL', 'Pomelo.EntityFrameworkCore.MySql'], 0.9),
      ...nuget(
        ['Oracle.EntityFrameworkCore', 'MongoDB.EntityFrameworkCore', 'MySql.EntityFrameworkCore'],
        0.9,
      ),
    ],
  },
  {
    id: 'orm.gorm',
    signals: [
      ...gomod('gorm.io/gorm', 0.95),
      ...gomod([/^gorm\.io\/driver\/[\w.-]+$/, 'github.com/jinzhu/gorm'], 0.9),
    ],
  },
  { id: 'orm.sqlx', signals: [...cargo('sqlx', 0.95), ...gomod('github.com/jmoiron/sqlx', 0.9)] },
  { id: 'orm.diesel', signals: [...cargo('diesel', 0.95), file('diesel.toml', 0.8)] },

  // ----- infrastructure -----
  {
    id: 'infra.docker',
    signals: [
      file('Dockerfile', 0.9),
      file('Containerfile', 0.85),
      file(/^Dockerfile\.[\w.-]+$/, 0.85),
      file(/^[\w.-]+\.[Dd]ockerfile$/, 0.85),
      file(/^(?:docker-)?compose(?:\.[\w-]+)*\.ya?ml$/, 0.8),
      file('.dockerignore', 0.5),
    ],
  },
  {
    id: 'infra.kubernetes',
    signals: [
      file(/^kustomization\.ya?ml$/, 0.9),
      file('skaffold.yaml', 0.7),
      file('Tiltfile', 0.6),
      dir(/(?:^|\/)(?:k8s|kubernetes)$/, 0.6),
      ...npm('@kubernetes/client-node', 0.6),
      ...pypi('kubernetes', 0.6),
      ...gomod('k8s.io/client-go', 0.7),
      ...gomod('sigs.k8s.io/controller-runtime', 0.8),
      ...maven('io.fabric8:kubernetes-client', 0.6),
    ],
  },
  {
    id: 'infra.helm',
    implies: ['infra.kubernetes'],
    signals: [file('Chart.yaml', 0.95), file(/^helmfile\.ya?ml$/, 0.8)],
  },
  {
    id: 'infra.terraform',
    signals: [
      ext('.tf', 0.9),
      ext('.tofu', 0.9),
      file('.terraform.lock.hcl', 0.9),
      file('terragrunt.hcl', 0.8),
      ...npm('cdktf', 0.7),
    ],
  },
  {
    id: 'infra.ansible',
    signals: [
      file('ansible.cfg', 0.9),
      file(/^(?:site|playbook[\w-]*)\.ya?ml$/, 0.5),
      dir(/(?:^|\/)roles\/[\w.-]+\/tasks$/, 0.6),
      dir(/(?:^|\/)(?:group_vars|host_vars)$/, 0.6),
      ...pypi(['ansible', 'ansible-core'], 0.8),
    ],
  },
  {
    id: 'infra.serverless',
    signals: [
      file(/^serverless\.(?:ya?ml|ts|js|json)$/, 0.9),
      file('samconfig.toml', 0.9),
      ...npm('serverless', 0.9, 0.8),
    ],
  },
  { id: 'ci.github-actions', signals: [dir(/^\.github\/workflows$/, 0.95)] },
  { id: 'ci.gitlab-ci', signals: [file('.gitlab-ci.yml', 0.95, /^$/)] },
  { id: 'ci.jenkins', signals: [file('Jenkinsfile', 0.95), file(/^Jenkinsfile\.[\w.-]+$/, 0.8)] },
  { id: 'ci.azure-pipelines', signals: [file(/^azure-pipelines(?:[.-][\w-]+)?\.ya?ml$/, 0.95)] },
  { id: 'ci.circleci', signals: [dir(/^\.circleci$/, 0.95)] },

  // ----- cloud -----
  {
    id: 'cloud.aws',
    signals: [
      ...npm([/^@aws-sdk\/[\w.-]+$/, 'aws-sdk', 'aws-cdk-lib'], 0.8),
      ...npm([/^@aws-cdk\/[\w.-]+$/, 'aws-amplify', /^@aws-amplify\/[\w.-]+$/], 0.7),
      ...pypi(['boto3', 'aiobotocore', 'aws-cdk-lib', 'aws-lambda-powertools', 'chalice'], 0.85),
      ...pypi(['botocore', /^aws-cdk-[\w-]+$/], 0.7),
      ...gomod(/^github\.com\/aws\/aws-sdk-go(?:-v2)?(?:\/[\w./-]+)?$/, 0.85),
      ...gomod('github.com/aws/aws-lambda-go', 0.85),
      ...cargo([/^aws-sdk-[\w-]+$/, 'aws-config', 'lambda_runtime'], 0.85),
      ...maven(
        [/^software\.amazon\.awssdk:[\w.-]+$/, /^com\.amazonaws:[\w.-]+$/, /^io\.awspring\.cloud:[\w.-]+$/],
        0.85,
      ),
      ...nuget([/^AWSSDK\.[\w.]+$/, 'Amazon.Lambda.Core'], 0.85),
      ...composer(['aws/aws-sdk-php', 'bref/bref'], 0.85),
      ...gem(/^aws-sdk(?:-[\w-]+)?$/, 0.85),
      ...hex('ex_aws', 0.8),
      file('cdk.json', 0.8),
      file(/^buildspec\.ya?ml$/, 0.6),
      image(/(?:^|\/)localstack$/),
      env(0.4, 'AWS_'),
    ],
  },
  {
    id: 'cloud.gcp',
    signals: [
      ...npm(/^@google-cloud\/[\w.-]+$/, 0.85),
      ...pypi(/^google-cloud-[\w-]+$/, 0.85),
      ...gomod(/^cloud\.google\.com\/go(?:\/[\w./-]+)?$/, 0.85),
      ...maven(/^com\.google\.cloud(?:\.[\w-]+)*:[\w.-]+$/, 0.85),
      ...nuget(/^Google\.Cloud\.[\w.]+$/, 0.85),
      ...composer(/^google\/cloud(?:-[\w-]+)?$/, 0.85),
      ...gem(/^google-cloud(?:-[\w-]+)?$/, 0.85),
      ...cargo(/^google-cloud-[\w-]+$/, 0.8),
      file(/^cloudbuild\.ya?ml$/, 0.7),
      env(0.4, 'GOOGLE_CLOUD_', 'GCP_', 'GCLOUD_', 'GOOGLE_APPLICATION_CREDENTIALS'),
    ],
  },
  {
    id: 'cloud.azure',
    signals: [
      ...npm(/^@azure\/[\w.-]+$/, 0.85),
      ...pypi(/^azure-[\w-]+$/, 0.85),
      ...gomod(/^github\.com\/Azure\/azure-sdk-for-go(?:\/[\w./-]+)?$/, 0.85),
      ...maven(/^com\.azure(?:\.[\w-]+)*:[\w.-]+$/, 0.85),
      ...maven(/^com\.microsoft\.azure(?:\.[\w-]+)*:[\w.-]+$/, 0.8),
      ...nuget(/^Azure\.[\w.]+$/, 0.85),
      ...nuget(/^Microsoft\.Azure\.[\w.]+$/, 0.8),
      ...cargo(/^azure_[\w]+$/, 0.8),
      ...gem(/^azure(?:-[\w-]+)?$/, 0.7),
      file('azure.yaml', 0.6),
      env(0.4, 'AZURE_'),
    ],
  },
  {
    id: 'cloud.firebase',
    signals: [
      ...npm(['firebase', 'firebase-admin', 'firebase-functions'], 0.9),
      ...npm(['@angular/fire', 'reactfire'], 0.8),
      ...pypi('firebase-admin', 0.9),
      ...gomod('firebase.google.com/go', 0.9),
      ...maven('com.google.firebase:firebase-admin', 0.9),
      ...maven(/^com\.google\.firebase:[\w.-]+$/, 0.85),
      ...maven('plugin:com.google.gms.google-services', 0.7),
      ...nuget('FirebaseAdmin', 0.9),
      ...composer(['kreait/firebase-php', 'kreait/laravel-firebase'], 0.9),
      ...pub(['firebase_core', 'cloud_firestore', 'firebase_auth'], 0.9),
      file('firebase.json', 0.9),
      file('.firebaserc', 0.9),
      file('firestore.rules', 0.8),
      env(0.4, 'FIREBASE_'),
    ],
  },
  {
    id: 'cloud.supabase',
    implies: ['db.postgresql'],
    signals: [
      ...npm(['@supabase/supabase-js', '@supabase/ssr', '@supabase/auth-helpers-nextjs'], 0.95),
      ...npm('supabase', 0.8, 0.8),
      ...pypi('supabase', 0.9),
      ...pub('supabase_flutter', 0.95),
      ...gomod('github.com/supabase-community/supabase-go', 0.9),
      ...nuget('Supabase', 0.9),
      file('config.toml', 0.9, /(?:^|\/)supabase$/),
      dir(/(?:^|\/)supabase\/migrations$/, 0.8),
      image(/^supabase\/[\w.-]+$/),
      env(0.5, 'SUPABASE_'),
    ],
  },

  // ----- messaging / tools -----
  {
    id: 'tool.kafka',
    signals: [
      ...npm(['kafkajs', '@confluentinc/kafka-javascript', 'node-rdkafka'], 0.9),
      ...pypi(['kafka-python', 'confluent-kafka', 'aiokafka'], 0.9),
      ...pypi('faust-streaming', 0.8),
      ...gomod(['github.com/segmentio/kafka-go', 'github.com/IBM/sarama', 'github.com/Shopify/sarama'], 0.9),
      ...gomod(['github.com/confluentinc/confluent-kafka-go', 'github.com/twmb/franz-go'], 0.9),
      ...cargo('rdkafka', 0.9),
      ...maven(['org.apache.kafka:kafka-clients', 'org.apache.kafka:kafka-streams'], 0.9),
      ...maven(['org.springframework.kafka:spring-kafka', 'io.quarkus:quarkus-kafka-client'], 0.9),
      ...nuget('Confluent.Kafka', 0.9),
      ...gem(['ruby-kafka', 'rdkafka', 'karafka', 'racecar'], 0.9),
      ...hex(['brod', 'kafka_ex', 'broadway_kafka'], 0.9),
      image(/(?:^|\/)(?:kafka|cp-kafka|cp-server|redpanda)$/),
      scheme('kafka'),
      env(0.4, 'KAFKA_'),
    ],
  },
  {
    id: 'tool.rabbitmq',
    signals: [
      ...npm(['amqplib', 'amqp-connection-manager', '@golevelup/nestjs-rabbitmq', 'rascal'], 0.9),
      ...pypi(['pika', 'aio-pika', 'aiormq'], 0.9),
      ...gomod(['github.com/rabbitmq/amqp091-go', 'github.com/streadway/amqp'], 0.9),
      ...cargo('lapin', 0.9),
      ...maven(['com.rabbitmq:amqp-client', 'org.springframework.boot:spring-boot-starter-amqp'], 0.9),
      ...maven('org.springframework.amqp:spring-rabbit', 0.9),
      ...nuget(['RabbitMQ.Client', 'MassTransit.RabbitMQ', 'EasyNetQ'], 0.9),
      ...composer('php-amqplib/php-amqplib', 0.9),
      ...gem(['bunny', 'sneakers'], 0.9),
      ...hex('amqp', 0.9),
      image(/(?:^|\/)rabbitmq$/),
      scheme('amqp', 'amqps'),
      env(0.4, 'RABBITMQ_', 'AMQP_'),
    ],
  },
  {
    id: 'tool.sqs',
    signals: [
      ...npm(['@aws-sdk/client-sqs', '@aws-sdk/client-sns', 'sqs-consumer', 'sqs-producer'], 0.9),
      ...gomod(['github.com/aws/aws-sdk-go-v2/service/sqs', 'github.com/aws/aws-sdk-go-v2/service/sns'], 0.9),
      ...cargo(['aws-sdk-sqs', 'aws-sdk-sns'], 0.9),
      ...maven(['software.amazon.awssdk:sqs', 'software.amazon.awssdk:sns'], 0.9),
      ...maven('io.awspring.cloud:spring-cloud-aws-starter-sqs', 0.9),
      ...nuget(['AWSSDK.SQS', 'AWSSDK.SimpleNotificationService'], 0.9),
      ...gem(['aws-sdk-sqs', 'aws-sdk-sns', 'shoryuken'], 0.9),
      env(0.4, 'SQS_'),
    ],
  },
  {
    id: 'tool.nats',
    signals: [
      ...npm(['nats', '@nats-io/transport-node'], 0.9),
      ...pypi('nats-py', 0.9),
      ...gomod('github.com/nats-io/nats.go', 0.9),
      ...cargo('async-nats', 0.9),
      ...maven('io.nats:jnats', 0.9),
      ...nuget(['NATS.Client', 'NATS.Net'], 0.9),
      ...gem('nats-pure', 0.9),
      image(/(?:^|\/)nats$/),
      scheme('nats'),
      env(0.4, 'NATS_'),
    ],
  },
  {
    id: 'tool.llm-sdk',
    signals: [
      ...npm(['openai', '@anthropic-ai/sdk', '@anthropic-ai/claude-agent-sdk', /^@ai-sdk\/[\w.-]+$/], 0.9),
      ...npm(['langchain', /^@langchain\/[\w.-]+$/, '@google/generative-ai', '@google/genai'], 0.9),
      ...npm(['@mistralai/mistralai', 'cohere-ai', 'ollama', 'groq-sdk', 'llamaindex'], 0.9),
      ...npm(
        ['@modelcontextprotocol/sdk', '@modelcontextprotocol/server', '@modelcontextprotocol/client'],
        0.8,
      ),
      ...npm(
        ['@aws-sdk/client-bedrock-runtime', '@aws-sdk/client-bedrock-agent-runtime', '@openai/agents'],
        0.9,
      ),
      ...npm('ai', 0.8),
      ...pypi(['openai', 'anthropic', 'langchain', /^langchain-[\w-]+$/, 'litellm', 'llama-index'], 0.9),
      ...pypi(['google-generativeai', 'google-genai', 'mistralai', 'cohere', 'ollama', 'groq'], 0.9),
      ...pypi('instructor', 0.7),
      ...pypi(['mcp', 'pydantic-ai', 'pydantic-ai-slim', 'openai-agents', 'crewai', 'dspy', 'dspy-ai'], 0.8),
      ...gomod(['github.com/sashabaranov/go-openai', 'github.com/openai/openai-go'], 0.9),
      ...gomod(['github.com/anthropics/anthropic-sdk-go', 'github.com/tmc/langchaingo'], 0.9),
      ...cargo('async-openai', 0.9),
      ...maven(['com.openai:openai-java', 'com.anthropic:anthropic-java'], 0.9),
      ...maven([/^dev\.langchain4j:[\w.-]+$/, /^org\.springframework\.ai:[\w.-]+$/], 0.9),
      ...nuget(['OpenAI', 'Azure.AI.OpenAI', 'Anthropic.SDK', 'Microsoft.SemanticKernel'], 0.9),
      ...composer(['openai-php/client', 'openai-php/laravel'], 0.9),
      ...gem(['ruby-openai', 'anthropic', 'langchainrb'], 0.9),
      env(
        0.4,
        'OPENAI_',
        'ANTHROPIC_',
        'GEMINI_API_KEY',
        'MISTRAL_API_KEY',
        'COHERE_API_KEY',
        'GROQ_API_KEY',
      ),
    ],
  },
];

// ---------------------------------------------------------------------------
// Content rules (config files read as text, never executed)
// ---------------------------------------------------------------------------

const PG = 'db.postgresql' as const;
const MY = 'db.mysql' as const;
const LITE = 'db.sqlite' as const;
const MSSQL = 'db.sqlserver' as const;
const ORA = 'db.oracle' as const;
const MONGO = 'db.mongodb' as const;
const ROACH = 'db.cockroachdb' as const;

/** JDBC sub-protocol (`jdbc:<x>:`) → database. */
export const JDBC: Record<string, TechId> = {
  postgresql: PG,
  mysql: MY,
  mariadb: MY,
  sqlserver: MSSQL,
  oracle: ORA,
  sqlite: LITE,
  clickhouse: 'db.clickhouse',
  ch: 'db.clickhouse',
  cockroach: ROACH,
};

export const TEXT_RULES: TextRule[] = [
  {
    kinds: ['prisma'],
    re: /^\s*provider\s*=\s*"(\w+)"/,
    map: {
      postgresql: PG,
      postgres: PG,
      mysql: MY,
      sqlite: LITE,
      sqlserver: MSSQL,
      mongodb: MONGO,
      cockroachdb: ROACH,
    },
    w: 0.95,
    what: 'Prisma datasource provider',
  },
  {
    kinds: ['drizzle'],
    re: /\bdialect\s*:\s*['"](\w+)['"]/,
    map: {
      postgresql: PG,
      mysql: MY,
      sqlite: LITE,
      turso: LITE,
      singlestore: MY,
      mssql: MSSQL,
      cockroach: ROACH,
    },
    w: 0.95,
    what: 'Drizzle dialect',
  },
  {
    kinds: ['drizzle'],
    re: /\bdriver\s*:\s*['"]([\w-]+)['"]/,
    map: {
      pg: PG,
      pglite: PG,
      mysql2: MY,
      'better-sqlite': LITE,
      libsql: LITE,
      turso: LITE,
      d1: LITE,
      'd1-http': LITE,
    },
    w: 0.9,
    what: 'Drizzle driver',
  },
  {
    kinds: ['typeorm'],
    re: /['"]?\btype['"]?\s*:\s*['"]([\w-]+)['"]/,
    map: {
      postgres: PG,
      'aurora-postgres': PG,
      mysql: MY,
      mariadb: MY,
      'aurora-mysql': MY,
      sqlite: LITE,
      'better-sqlite3': LITE,
      sqljs: LITE,
      mssql: MSSQL,
      oracle: ORA,
      mongodb: MONGO,
      cockroachdb: ROACH,
    },
    w: 0.9,
    what: 'TypeORM connection type',
  },
  {
    kinds: ['knex'],
    re: /\bclient\s*:\s*['"]([\w-]+)['"]/,
    map: {
      pg: PG,
      postgres: PG,
      postgresql: PG,
      mysql: MY,
      mysql2: MY,
      sqlite3: LITE,
      'better-sqlite3': LITE,
      mssql: MSSQL,
      oracledb: ORA,
      cockroachdb: ROACH,
    },
    w: 0.9,
    what: 'Knex client',
  },
  {
    kinds: ['sequelize'],
    re: /['"]?\bdialect['"]?\s*:\s*['"](\w+)['"]/,
    map: { postgres: PG, mysql: MY, mariadb: MY, sqlite: LITE, mssql: MSSQL, oracle: ORA },
    w: 0.9,
    what: 'Sequelize dialect',
  },
  {
    kinds: ['django-settings'],
    re: /\bdjango\.(?:contrib\.gis\.)?db\.backends\.(\w+)/,
    map: {
      postgresql: PG,
      postgresql_psycopg2: PG,
      postgis: PG,
      mysql: MY,
      sqlite3: LITE,
      spatialite: LITE,
      oracle: ORA,
    },
    w: 0.95,
    what: 'Django database ENGINE',
  },
  {
    kinds: ['django-settings'],
    re: /['"]ENGINE['"]\s*:\s*['"]([\w.]+)['"]/,
    map: {
      mssql: MSSQL,
      'sql_server.pyodbc': MSSQL,
      django_cockroachdb: ROACH,
      djongo: MONGO,
      django_mongodb_backend: MONGO,
    },
    w: 0.9,
    what: 'Django database ENGINE',
  },
  {
    kinds: ['spring-config'],
    re: /\bjdbc:(?:tc:)?(\w+):/,
    map: JDBC,
    w: 0.95,
    what: 'JDBC URL',
  },
  {
    kinds: ['spring-config'],
    re: /^\s*spring\.(?:data\.)?(mongodb|redis|elasticsearch|cassandra|neo4j|kafka|rabbitmq|jpa)\./,
    map: {
      mongodb: MONGO,
      redis: 'db.redis',
      elasticsearch: 'db.elasticsearch',
      cassandra: 'db.cassandra',
      neo4j: 'db.neo4j',
      kafka: 'tool.kafka',
      rabbitmq: 'tool.rabbitmq',
      jpa: 'orm.hibernate',
    },
    w: 0.8,
    what: 'Spring property',
  },
  {
    kinds: ['spring-config'],
    re: /^\s*quarkus\.datasource\.(?:[\w-]+\.)?db-kind\s*[=:]\s*['"]?(\w+)/,
    map: { postgresql: PG, pg: PG, mysql: MY, mariadb: MY, mssql: MSSQL, oracle: ORA },
    w: 0.95,
    what: 'Quarkus datasource db-kind',
  },
  {
    kinds: ['spring-config'],
    re: /^\s*quarkus\.(mongodb|redis|kafka|rabbitmq)\./,
    map: { mongodb: MONGO, redis: 'db.redis', kafka: 'tool.kafka', rabbitmq: 'tool.rabbitmq' },
    w: 0.8,
    what: 'Quarkus property',
  },
  {
    kinds: ['rails-db'],
    re: /^\s*adapter:\s*['"]?(\w+)/,
    map: {
      postgresql: PG,
      postgis: PG,
      mysql2: MY,
      trilogy: MY,
      sqlite3: LITE,
      sqlserver: MSSQL,
      oracle_enhanced: ORA,
      cockroachdb: ROACH,
    },
    w: 0.95,
    what: 'Rails database adapter',
  },
  {
    kinds: ['env'],
    re: /^\s*(?:export\s+)?DB_CONNECTION\s*=\s*['"]?(\w+)/,
    map: { pgsql: PG, mysql: MY, mariadb: MY, sqlite: LITE, sqlsrv: MSSQL, mongodb: MONGO },
    w: 0.9,
    what: 'DB_CONNECTION',
  },
  {
    kinds: ['env'],
    re: /^\s*(?:CACHE_DRIVER|CACHE_STORE|SESSION_DRIVER|QUEUE_CONNECTION|BROADCAST_DRIVER|BROADCAST_CONNECTION)\s*=\s*['"]?(redis)\b/,
    map: { redis: 'db.redis' },
    w: 0.6,
    what: 'driver setting',
  },
  {
    kinds: ['laravel-db'],
    re: /'default'\s*=>\s*env\(\s*'DB_CONNECTION'\s*,\s*'(\w+)'/,
    map: { pgsql: PG, mysql: MY, mariadb: MY, sqlite: LITE, sqlsrv: MSSQL },
    w: 0.5,
    what: 'Laravel default connection',
  },
  {
    kinds: ['dotnet-code'],
    re: /\.Use(Npgsql|SqlServer|MySql|MySQL|Sqlite|Oracle|MongoDB)\s*\(/,
    map: { npgsql: PG, sqlserver: MSSQL, mysql: MY, sqlite: LITE, oracle: ORA, mongodb: MONGO },
    w: 0.9,
    what: 'EF Core provider',
  },
  {
    kinds: ['dotnet-code'],
    re: /\bAddStackExchangeRedisCache\s*\(/,
    map: 'db.redis',
    w: 0.8,
    what: 'AddStackExchangeRedisCache',
  },
  {
    kinds: ['appsettings'],
    re: /\bHost\s*=[^;"]+;\s*(?:Port\s*=\s*\d+;\s*)?(?:Database|Username)\s*=/,
    map: PG,
    w: 0.5,
    what: 'Npgsql connection string',
  },
  {
    kinds: ['appsettings'],
    re: /\b(?:Trusted_Connection|TrustServerCertificate|MultipleActiveResultSets)\s*=/i,
    map: MSSQL,
    w: 0.5,
    what: 'SqlClient connection string',
  },
  // SQL dialect hints (first 8 KB of a few .sql files)
  {
    kinds: ['sql'],
    re: /\b(?:BIG)?SERIAL\b|\bJSONB\b|::(?:text|int|jsonb|uuid|date|timestamptz)\b|\bTIMESTAMPTZ\b|\bCREATE\s+EXTENSION\b/i,
    map: PG,
    w: 0.3,
    what: 'PostgreSQL syntax',
  },
  {
    kinds: ['sql'],
    re: /\bAUTO_INCREMENT\b|\bENGINE\s*=\s*InnoDB\b/i,
    map: MY,
    w: 0.3,
    what: 'MySQL syntax',
  },
  { kinds: ['sql'], re: /^\s*PRAGMA\s|\bAUTOINCREMENT\b/i, map: LITE, w: 0.3, what: 'SQLite syntax' },
  {
    kinds: ['sql'],
    re: /\bNVARCHAR\s*\(\s*MAX\b|^\s*GO\s*$|\bIDENTITY\s*\(\s*1\s*,\s*1\s*\)/i,
    map: MSSQL,
    w: 0.3,
    what: 'T-SQL syntax',
  },
  { kinds: ['sql'], re: /\bVARCHAR2\b|\bNUMBER\s*\(\s*\d/i, map: ORA, w: 0.3, what: 'Oracle syntax' },
  {
    kinds: ['sql'],
    re: /\bENGINE\s*=\s*\w*MergeTree\b/i,
    map: 'db.clickhouse',
    w: 0.3,
    what: 'ClickHouse syntax',
  },
  // Terraform / CloudFormation / Kubernetes / CI
  {
    kinds: ['terraform'],
    re: /^\s*provider\s+"([\w-]+)"/,
    map: {
      aws: 'cloud.aws',
      google: 'cloud.gcp',
      'google-beta': 'cloud.gcp',
      azurerm: 'cloud.azure',
      azuread: 'cloud.azure',
    },
    w: 0.8,
    what: 'Terraform provider',
  },
  {
    kinds: ['terraform'],
    re: /\bsource\s*=\s*"(?:registry\.terraform\.io\/)?hashicorp\/([\w-]+)"/,
    map: {
      aws: 'cloud.aws',
      google: 'cloud.gcp',
      'google-beta': 'cloud.gcp',
      azurerm: 'cloud.azure',
      azuread: 'cloud.azure',
    },
    w: 0.8,
    what: 'Terraform provider',
  },
  {
    kinds: ['terraform'],
    re: /^\s*resource\s+"aws_(dynamodb|sqs|sns|elasticache|msk|opensearch|elasticsearch)_/,
    map: {
      dynamodb: 'db.dynamodb',
      sqs: 'tool.sqs',
      sns: 'tool.sqs',
      elasticache: 'db.redis',
      msk: 'tool.kafka',
      opensearch: 'db.elasticsearch',
      elasticsearch: 'db.elasticsearch',
    },
    w: 0.6,
    what: 'Terraform resource',
  },
  {
    kinds: ['sam'],
    re: /^\s*Transform:\s*['"]?AWS::Serverless/,
    map: 'infra.serverless',
    w: 0.9,
    what: 'SAM transform',
  },
  {
    kinds: ['sam'],
    re: /^\s*AWSTemplateFormatVersion\s*:/,
    map: 'cloud.aws',
    w: 0.8,
    what: 'CloudFormation template',
  },
  {
    kinds: ['sam'],
    re: /^\s*Type:\s*['"]?AWS::(DynamoDB|SQS|SNS)::/,
    map: { dynamodb: 'db.dynamodb', sqs: 'tool.sqs', sns: 'tool.sqs' },
    w: 0.7,
    what: 'CloudFormation resource',
  },
  {
    kinds: ['k8s'],
    re: /^kind:\s*(?:Deployment|StatefulSet|DaemonSet|Service|Ingress|CronJob|Job|ConfigMap|Pod|HorizontalPodAutoscaler)\s*$/,
    map: 'infra.kubernetes',
    w: 0.8,
    what: 'Kubernetes manifest',
  },
  {
    kinds: ['github-workflow'],
    re: /^\s*(?:-\s*)?uses:\s*['"]?(aws-actions|google-github-actions|azure)\//,
    map: {
      'aws-actions': 'cloud.aws',
      'google-github-actions': 'cloud.gcp',
      azure: 'cloud.azure',
    },
    w: 0.5,
    what: 'GitHub Action',
  },
  {
    kinds: ['github-workflow'],
    re: /^\s*(?:-\s*)?uses:\s*['"]?hashicorp\/setup-terraform@/,
    map: 'infra.terraform',
    w: 0.6,
    what: 'GitHub Action setup-terraform',
  },
  {
    kinds: ['tool-versions'],
    re: /^\s*(nodejs|node|deno|bun)\s+[^\s#]/,
    map: { nodejs: 'runtime.node', node: 'runtime.node', deno: 'runtime.deno', bun: 'runtime.bun' },
    w: 0.6,
    what: '.tool-versions entry',
  },
];

// ---------------------------------------------------------------------------
// Version sources
// ---------------------------------------------------------------------------

/** A dependency whose declared version is the version of `techs`. */
export interface VersionDep {
  eco: Eco;
  name: string | RegExp;
  techs: TechId[];
}

const ver = (eco: Eco, names: Name | Name[], ...techs: TechId[]): VersionDep[] =>
  (Array.isArray(names) ? names : [names]).map((name) => ({ eco, name, techs }));

/**
 * Dependencies whose declared version IS the version of a tech. Deliberately absent: database drivers
 * (`pg` 8 says nothing about the PostgreSQL server), plugins and adapters (`@vitejs/plugin-react`,
 * `drizzle-kit`, `@sveltejs/kit`), and packages versioned independently of the framework
 * (`org.springframework:*` is Spring Framework 6/7, not Spring Boot; `Microsoft.AspNetCore.*` NuGet
 * packages; Expo SDK). Language / runtime versions declared outside dependency lists (go directive,
 * `requires-python`, TargetFramework, …) come from the manifest parsers.
 */
export const VERSION_DEPS: VersionDep[] = [
  // package.json runtime fields (pseudo-dependencies)
  ...ver('npm', ['engines:node', 'volta:node', 'devEngines:node'], 'runtime.node'),
  ...ver('npm', ['engines:bun', 'devEngines:bun', 'packageManager:bun'], 'runtime.bun'),
  ...ver('npm', ['engines:deno', 'devEngines:deno'], 'runtime.deno'),
  // JavaScript / TypeScript
  ...ver('npm', 'typescript', 'lang.typescript'),
  ...ver('npm', ['react', 'react-dom'], 'framework.react'),
  ...ver('npm', 'next', 'framework.nextjs'),
  ...ver('npm', ['@remix-run/react', '@remix-run/node', '@react-router/dev'], 'framework.remix'),
  ...ver('npm', 'vue', 'framework.vue'),
  ...ver('npm', 'nuxt', 'framework.nuxt'),
  ...ver('npm', '@angular/core', 'framework.angular'),
  ...ver('npm', 'svelte', 'framework.svelte'),
  ...ver('npm', 'astro', 'framework.astro'),
  ...ver('npm', 'solid-js', 'framework.solid'),
  ...ver('npm', 'react-native', 'framework.react-native'),
  ...ver('npm', 'electron', 'framework.electron'),
  ...ver('npm', 'express', 'framework.express'),
  ...ver('npm', 'fastify', 'framework.fastify'),
  ...ver('npm', 'koa', 'framework.koa'),
  ...ver('npm', 'hono', 'framework.hono'),
  ...ver('npm', ['@nestjs/core', '@nestjs/common'], 'framework.nestjs'),
  ...ver('npm', ['@trpc/server', '@trpc/client'], 'framework.trpc'),
  ...ver('npm', ['prisma', '@prisma/client'], 'orm.prisma'),
  ...ver('npm', 'typeorm', 'orm.typeorm'),
  ...ver('npm', 'sequelize', 'orm.sequelize'),
  ...ver('npm', 'drizzle-orm', 'orm.drizzle'),
  ...ver('npm', 'knex', 'orm.knex'),
  ...ver('npm', 'mongoose', 'orm.mongoose'),
  // Python
  ...ver('pypi', 'django', 'framework.django', 'orm.django'),
  ...ver('pypi', 'flask', 'framework.flask'),
  ...ver('pypi', 'fastapi', 'framework.fastapi'),
  ...ver('pypi', 'celery', 'framework.celery'),
  ...ver('pypi', 'sqlalchemy', 'orm.sqlalchemy'),
  // JVM (Spring Boot parent / BOM / starters / Gradle plugin all carry the Boot version)
  ...ver(
    'maven',
    [/^org\.springframework\.boot:[\w.-]+$/, 'plugin:org.springframework.boot'],
    'framework.spring',
  ),
  ...ver(
    'maven',
    [/^io\.quarkus(?:\.platform)?:quarkus-(?:bom|universe-bom|maven-plugin)$/, 'plugin:io.quarkus'],
    'framework.quarkus',
  ),
  ...ver('maven', ['org.hibernate.orm:hibernate-core', 'org.hibernate:hibernate-core'], 'orm.hibernate'),
  ...ver(
    'maven',
    [
      /^org\.jetbrains\.kotlin:kotlin-(?:stdlib(?:-jdk[78])?|gradle-plugin|maven-plugin)$/,
      /^plugin:org\.jetbrains\.kotlin\.[\w.-]+$/,
    ],
    'lang.kotlin',
  ),
  // .NET (lang.csharp / framework.aspnet come from TargetFramework)
  ...ver('nuget', /^Microsoft\.EntityFrameworkCore(?:\.[\w.]+)?$/, 'orm.efcore'),
  // PHP
  ...ver('composer', 'laravel/framework', 'framework.laravel', 'orm.eloquent'),
  ...ver('composer', 'illuminate/database', 'orm.eloquent'),
  ...ver('composer', 'symfony/framework-bundle', 'framework.symfony'),
  ...ver('composer', 'doctrine/orm', 'orm.doctrine'),
  // Ruby
  ...ver('gem', 'rails', 'framework.rails', 'orm.activerecord'),
  ...ver('gem', 'railties', 'framework.rails'),
  ...ver('gem', 'activerecord', 'orm.activerecord'),
  // Go (module paths are compared without their /vN suffix)
  ...ver('go', 'github.com/gin-gonic/gin', 'framework.gin'),
  ...ver('go', 'github.com/labstack/echo', 'framework.echo'),
  ...ver('go', 'github.com/gofiber/fiber', 'framework.fiber'),
  ...ver('go', 'github.com/go-chi/chi', 'framework.chi'),
  ...ver('go', 'gorm.io/gorm', 'orm.gorm'),
  // Rust (orm.sqlx also covers Go's jmoiron/sqlx, whose versions are unrelated: Rust only)
  ...ver('cargo', 'axum', 'framework.axum'),
  ...ver('cargo', 'actix-web', 'framework.actix'),
  ...ver('cargo', 'sqlx', 'orm.sqlx'),
  ...ver('cargo', 'diesel', 'orm.diesel'),
];

/** A container image whose tag is the version of `tech` (`node:22-alpine` → 22). */
export interface VersionImage {
  /** Normalised image path (see `normalizeImage`). */
  re: RegExp;
  tech: TechId;
  /** Variant prefix in front of the version (`denoland/deno:alpine-2.1.4`). */
  tagPrefix?: RegExp;
  /** Node.js LTS codename tags (`node:jod-alpine`). */
  codenames?: boolean;
}

/**
 * Official (and a few widespread) images whose tag starts with the runtime / server version. Forks and
 * compatibles with their own numbering are left out (MariaDB, Valkey, OpenSearch, Percona, TimescaleDB),
 * as are toolchain images whose version is not the language level of the code (`golang`: the go.mod
 * `go` directive decides; `mcr.microsoft.com/dotnet/*`: TargetFramework decides).
 */
export const VERSION_IMAGES: VersionImage[] = [
  { re: /(?:^|\/)node$/, tech: 'runtime.node', codenames: true },
  { re: /^denoland\/deno$/, tech: 'runtime.deno', tagPrefix: /^(?:alpine|debian|distroless|ubuntu|bin)-/ },
  { re: /^oven\/bun$/, tech: 'runtime.bun' },
  { re: /(?:^|\/)python$/, tech: 'lang.python' },
  { re: /(?:^|\/)ruby$/, tech: 'lang.ruby' },
  { re: /(?:^|\/)php$/, tech: 'lang.php' },
  {
    re: /^(?:eclipse-temurin|openjdk|amazoncorretto|sapmachine|azul\/zulu-openjdk(?:-alpine|-debian)?)$/,
    tech: 'lang.java',
  },
  { re: /^(?:postgres|postgis\/postgis|bitnami\/postgresql)$/, tech: 'db.postgresql' },
  { re: /^(?:mysql|mysql\/mysql-server|bitnami\/mysql)$/, tech: 'db.mysql' },
  { re: /^(?:redis|redis\/redis-stack(?:-server)?|bitnami\/redis)$/, tech: 'db.redis' },
  {
    re: /^(?:mongo|mongodb\/mongodb-(?:community|enterprise)-server|bitnami\/mongodb)$/,
    tech: 'db.mongodb',
  },
  { re: /^(?:elasticsearch\/)?elasticsearch$/, tech: 'db.elasticsearch' },
  { re: /^clickhouse\/clickhouse-server$/, tech: 'db.clickhouse' },
  { re: /^cassandra$/, tech: 'db.cassandra' },
  { re: /^neo4j$/, tech: 'db.neo4j' },
  { re: /^mssql\/server$/, tech: 'db.sqlserver' },
  { re: /^cockroachdb\/cockroach$/, tech: 'db.cockroachdb' },
];

/** Weight of a container image by where it was found. */
export const IMAGE_WEIGHT = {
  compose: 0.8,
  ci: 0.6,
  chart: 0.7,
  dockerfile: 0.5,
  k8s: 0.5,
} as const;

/** Weight of a URL scheme by the kind of file it was found in (kinds absent here are not scanned). */
export const SCHEME_WEIGHT: Partial<Record<FileKind, number>> = {
  env: 0.7,
  'spring-config': 0.8,
  alembic: 0.8,
  'rails-db': 0.8,
  compose: 0.6,
  appsettings: 0.6,
  'django-settings': 0.5,
  'github-workflow': 0.5,
  ci: 0.5,
  k8s: 0.5,
};

/** Env key prefixes that frameworks add for client-exposed variables (stripped before matching). */
export const PUBLIC_ENV_PREFIXES = [
  'NEXT_PUBLIC_',
  'NUXT_PUBLIC_',
  'VITE_',
  'REACT_APP_',
  'EXPO_PUBLIC_',
  'PUBLIC_',
];

/** Number of individual signals (dependency names, markers, content patterns, …) in the tables. */
export function ruleCount(): number {
  return RULES.reduce((n, r) => n + r.signals.length, 0) + TEXT_RULES.length;
}
