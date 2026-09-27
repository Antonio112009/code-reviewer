import type { TechCategory } from '../../types';

/**
 * Canonical technology ids shared by stack detection (`detect.ts` rules) and skill activation
 * (`activation.stack` in SKILL frontmatter). Only ids listed here may appear in either place.
 */
export const TECHS = {
  // languages
  'lang.javascript': ['JavaScript', 'language'],
  'lang.typescript': ['TypeScript', 'language'],
  'lang.python': ['Python', 'language'],
  'lang.php': ['PHP', 'language'],
  'lang.java': ['Java', 'language'],
  'lang.kotlin': ['Kotlin', 'language'],
  'lang.csharp': ['C#', 'language'],
  'lang.go': ['Go', 'language'],
  'lang.rust': ['Rust', 'language'],
  'lang.c': ['C', 'language'],
  'lang.cpp': ['C++', 'language'],
  'lang.ruby': ['Ruby', 'language'],
  'lang.swift': ['Swift', 'language'],
  'lang.scala': ['Scala', 'language'],
  'lang.dart': ['Dart', 'language'],
  'lang.elixir': ['Elixir', 'language'],
  'lang.shell': ['Shell', 'language'],
  'lang.sql': ['SQL', 'language'],
  // runtimes
  'runtime.node': ['Node.js', 'runtime'],
  'runtime.deno': ['Deno', 'runtime'],
  'runtime.bun': ['Bun', 'runtime'],
  // frontend / mobile / desktop frameworks
  'framework.react': ['React', 'framework'],
  'framework.nextjs': ['Next.js', 'framework'],
  'framework.remix': ['Remix / React Router', 'framework'],
  'framework.vue': ['Vue', 'framework'],
  'framework.nuxt': ['Nuxt', 'framework'],
  'framework.angular': ['Angular', 'framework'],
  'framework.svelte': ['Svelte / SvelteKit', 'framework'],
  'framework.astro': ['Astro', 'framework'],
  'framework.solid': ['SolidJS', 'framework'],
  'framework.react-native': ['React Native', 'framework'],
  'framework.flutter': ['Flutter', 'framework'],
  'framework.electron': ['Electron', 'framework'],
  'framework.android': ['Android', 'framework'],
  'framework.ios': ['iOS / SwiftUI', 'framework'],
  // backend frameworks
  'framework.express': ['Express', 'framework'],
  'framework.fastify': ['Fastify', 'framework'],
  'framework.koa': ['Koa', 'framework'],
  'framework.hono': ['Hono', 'framework'],
  'framework.nestjs': ['NestJS', 'framework'],
  'framework.trpc': ['tRPC', 'framework'],
  'framework.graphql': ['GraphQL', 'framework'],
  'framework.django': ['Django', 'framework'],
  'framework.flask': ['Flask', 'framework'],
  'framework.fastapi': ['FastAPI', 'framework'],
  'framework.celery': ['Celery', 'framework'],
  'framework.spring': ['Spring / Spring Boot', 'framework'],
  'framework.quarkus': ['Quarkus', 'framework'],
  'framework.laravel': ['Laravel', 'framework'],
  'framework.symfony': ['Symfony', 'framework'],
  'framework.rails': ['Ruby on Rails', 'framework'],
  'framework.aspnet': ['ASP.NET Core', 'framework'],
  'framework.gin': ['Gin', 'framework'],
  'framework.echo': ['Echo', 'framework'],
  'framework.fiber': ['Fiber', 'framework'],
  'framework.chi': ['chi', 'framework'],
  'framework.axum': ['Axum', 'framework'],
  'framework.actix': ['Actix Web', 'framework'],
  // databases
  'db.postgresql': ['PostgreSQL', 'database'],
  'db.mysql': ['MySQL / MariaDB', 'database'],
  'db.sqlite': ['SQLite', 'database'],
  'db.sqlserver': ['SQL Server', 'database'],
  'db.oracle': ['Oracle', 'database'],
  'db.mongodb': ['MongoDB', 'database'],
  'db.redis': ['Redis / Valkey', 'database'],
  'db.elasticsearch': ['Elasticsearch / OpenSearch', 'database'],
  'db.clickhouse': ['ClickHouse', 'database'],
  'db.cassandra': ['Cassandra / ScyllaDB', 'database'],
  'db.dynamodb': ['DynamoDB', 'database'],
  'db.neo4j': ['Neo4j', 'database'],
  'db.cockroachdb': ['CockroachDB', 'database'],
  // ORMs / data access
  'orm.prisma': ['Prisma', 'orm'],
  'orm.typeorm': ['TypeORM', 'orm'],
  'orm.sequelize': ['Sequelize', 'orm'],
  'orm.drizzle': ['Drizzle', 'orm'],
  'orm.knex': ['Knex', 'orm'],
  'orm.mongoose': ['Mongoose', 'orm'],
  'orm.sqlalchemy': ['SQLAlchemy', 'orm'],
  'orm.django': ['Django ORM', 'orm'],
  'orm.hibernate': ['Hibernate / JPA', 'orm'],
  'orm.eloquent': ['Eloquent', 'orm'],
  'orm.doctrine': ['Doctrine', 'orm'],
  'orm.activerecord': ['ActiveRecord', 'orm'],
  'orm.efcore': ['Entity Framework Core', 'orm'],
  'orm.gorm': ['GORM', 'orm'],
  'orm.sqlx': ['sqlx', 'orm'],
  'orm.diesel': ['Diesel', 'orm'],
  // infrastructure / CI / cloud
  'infra.docker': ['Docker', 'infra'],
  'infra.kubernetes': ['Kubernetes', 'infra'],
  'infra.helm': ['Helm', 'infra'],
  'infra.terraform': ['Terraform / OpenTofu', 'infra'],
  'infra.ansible': ['Ansible', 'infra'],
  'infra.serverless': ['Serverless Framework / SAM', 'infra'],
  'ci.github-actions': ['GitHub Actions', 'ci'],
  'ci.gitlab-ci': ['GitLab CI', 'ci'],
  'ci.jenkins': ['Jenkins', 'ci'],
  'ci.azure-pipelines': ['Azure Pipelines', 'ci'],
  'ci.circleci': ['CircleCI', 'ci'],
  'cloud.aws': ['AWS SDK', 'cloud'],
  'cloud.gcp': ['Google Cloud SDK', 'cloud'],
  'cloud.azure': ['Azure SDK', 'cloud'],
  'cloud.firebase': ['Firebase', 'cloud'],
  'cloud.supabase': ['Supabase', 'cloud'],
  // messaging & other tools
  'tool.kafka': ['Kafka', 'tool'],
  'tool.rabbitmq': ['RabbitMQ', 'tool'],
  'tool.sqs': ['SQS / SNS', 'tool'],
  'tool.nats': ['NATS', 'tool'],
  'tool.llm-sdk': ['LLM SDK (OpenAI, Anthropic, …)', 'tool'],
} as const satisfies Record<string, readonly [string, TechCategory]>;

export type TechId = keyof typeof TECHS;

export const TECH_IDS = Object.keys(TECHS) as TechId[];

export function isTechId(id: string): id is TechId {
  return Object.hasOwn(TECHS, id);
}

export function techName(id: TechId): string {
  return TECHS[id][0];
}

export function techCategory(id: TechId): TechCategory {
  return TECHS[id][1];
}
