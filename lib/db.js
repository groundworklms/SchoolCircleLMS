/**
 * Prisma client singleton.
 *
 * Next.js dev reloads modules on every save; a fresh PrismaClient per reload exhausts the
 * Postgres connection pool within a minute ("too many clients"). Caching it on globalThis
 * survives HMR, and in production a single instance is created once.
 *
 * Two ways to reach Postgres, selected by env -- the schema and every query are identical:
 *
 *   - Plain `DATABASE_URL` (default): local docker-compose, the offline Jetson, any TCP
 *     Postgres. This is the edge/offline path.
 *   - `CLOUD_SQL_CONNECTION_NAME=project:region:instance` (cloud): Firebase App Hosting has
 *     no VPC/private-IP or Cloud SQL socket out of the box, so we go through the Cloud SQL
 *     Node connector -- IAM-authorised, TLS to the instance's public IP, no authorized
 *     networks, no proxy sidecar. `DATABASE_URL` still supplies user/password/database
 *     (its host is ignored); the connector authenticates with Application Default
 *     Credentials (the App Hosting service account, or `gcloud auth ... --update-adc` locally).
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

/**
 * A lazy Prisma driver-adapter factory for Cloud SQL. `connector.getOptions()` is async, but
 * Prisma only calls `connect()` on first use, so `db` stays a synchronous export and no
 * route has to await client construction. Packages are imported here, not at module top,
 * so the offline build never loads google-auth.
 */
function cloudSqlAdapter(instanceConnectionName) {
  const url = new URL(process.env.DATABASE_URL);
  return {
    provider: 'postgres',
    adapterName: '@prisma/adapter-pg',
    async connect() {
      const [{ Connector }, { PrismaPg }] = await Promise.all([
        import('@google-cloud/cloud-sql-connector'),
        import('@prisma/adapter-pg'),
      ]);
      const connector = new Connector();
      const opts = await connector.getOptions({
        instanceConnectionName,
        ipType: process.env.CLOUD_SQL_IP_TYPE || 'PUBLIC',
      });
      const factory = new PrismaPg(
        {
          ...opts,
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
          database: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
          max: Number(url.searchParams.get('connection_limit')) || 5,
        },
        { schema: url.searchParams.get('schema') || 'public' },
      );
      const adapter = await factory.connect();
      // The connector keeps cert-refresh timers running; stop them with the pool so a
      // script that calls db.$disconnect() can exit.
      const dispose = adapter.dispose.bind(adapter);
      adapter.dispose = async () => {
        await dispose();
        connector.close();
      };
      return adapter;
    },
  };
}

function createClient() {
  const log = process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];
  const instance = process.env.CLOUD_SQL_CONNECTION_NAME;
  return instance ? new PrismaClient({ log, adapter: cloudSqlAdapter(instance) }) : new PrismaClient({ log });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

/**
 * The instructor's class view -- AGGREGATE by construction. It groups Attempt by section and
 * never selects learnerId, so it cannot return one Marine's answers. The privacy boundary is
 * this query shape, not a UI promise; keep it that way (no learner filter here).
 */
export async function classGaps() {
  // miss rate per section: 1 - (correct / attempts), grouped, no learner identity.
  const rows = await db.$queryRaw`
    SELECT s.title AS section,
           COUNT(a.*)::int AS attempts,
           (1.0 - (SUM(CASE WHEN a.correct THEN 1 ELSE 0 END)::float / NULLIF(COUNT(a.*), 0))) AS "missRate"
    FROM "Attempt" a
    JOIN "Item" i ON i.id = a."itemId"
    JOIN "Section" s ON s.id = i."sectionId"
    GROUP BY s.title
    ORDER BY "missRate" DESC NULLS LAST`;
  return rows;
}
