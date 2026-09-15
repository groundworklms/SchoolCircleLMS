# PostgreSQL: cloud now, local hardware later

This is the database foundation for GitHub issue #26, not a live rollout.
Use **Prisma + PostgreSQL** for both targets. Cloud SQL lives in
`schoolcircle-ae29a`; the hardware runs its own local PostgreSQL.
Firebase Auth remains unchanged. Firebase's public web API key is **not** a
Cloud SQL credential or authorization to provision Google Cloud resources.

## Delivery status and approval boundary

- This PR adds an initial migration, explicit database commands, guarded demo
  seeding, integration tests and an App Hosting configuration **template**.
- No Cloud SQL instance, network, secret, IAM grant, or live deployment is created
  by installing/building this code. The actual App Hosting configuration only
  links to the template; it does not reference an unprovisioned secret.
- Cloud provisioning needs authorized Google Cloud access and cost approval.
  Live connectivity, the deployed course reader and hardware/network-pulled
  verification must be checked after those steps; local tests do not prove them.
- Do not merge this feature branch or deploy automatically. Review the PR first.
  Coordinate with the owner of issue #4 before changing shared database state.

## 1. Inventory and cost approval (read-only first)

In Google Cloud Console, select `schoolcircle-ae29a`. Inspect Cloud SQL for an
existing PostgreSQL instance, databases and region. In Firebase App Hosting,
inspect the `dev` backend's region and service account. Reuse a suitable approved
instance rather than creating a duplicate.

For an isolated short-lived demo, consider **PostgreSQL 16, Enterprise edition,
single-zone, shared-core db-f1-micro, minimum supported SSD storage**, in the
same region as the App Hosting backend. This is a proposal, not a requirement
or a production sizing recommendation; shared-core has limited capacity and
is not an HA production setup. If unavailable, quote the smallest supported
alternative before proceeding.

Get a current estimate from the [Cloud SQL pricing calculator][pricing] for the
actual region, compute, storage, backups and network. Budget alerts do not cap
spending. Obtain owner approval for the estimate, region, retention/backup
settings and planned lifetime **before provisioning**. Keep deletion protection
enabled until a separate cleanup approval; back up anything worth preserving.
Stopping compute can leave storage/backup charges, and deleting a database is
irreversible without a usable backup.

## 2. Connectivity and credentials

### What is live (hackathon, 2026-09-15)

The app talks to the Firebase Data Connect trial instance
`schoolcircle-ae29a:us-east4:schoolcircle-ae29a-instance` (public IP only,
legacy per-instance CA, `db-f1-micro`) through the **Cloud SQL Node connector**,
not a VPC. `lib/db.js` switches to a Prisma `pg` driver adapter backed by the
connector when `CLOUD_SQL_CONNECTION_NAME` is set; the connector authenticates
with the App Hosting service account (`roles/cloudsql.client`) and encrypts to
the instance, so no authorized networks, TLS certificate files, or private IP
are needed. `DATABASE_URL` (Secret Manager secret `DATABASE_URL`) still supplies
user/password/database; its host is ignored in the cloud. Database
`schoolcircle_demo`, user `schoolcircle_app` (kept separate from any Data
Connect-managed database on the same instance).

Migrations and seeds run from a laptop with `gcloud auth login --update-adc`:

```bash
export CLOUD_SQL_CONNECTION_NAME=schoolcircle-ae29a:us-east4:schoolcircle-ae29a-instance
npm run db:proxy            # loopback 127.0.0.1:5433 -> instance, in a second terminal
export DATABASE_URL='postgresql://schoolcircle_app:PASSWORD@127.0.0.1:5433/schoolcircle_demo?schema=public'
export DATABASE_TARGET_CONFIRM=schoolcircle_demo SCHOOLCIRCLE_DB_ENV=demo
npm run db:deploy
NODE_ENV=development ALLOW_DEMO_SEED=true npm run db:seed
```

**Switching to the offline box:** leave `CLOUD_SQL_CONNECTION_NAME` unset, point
`DATABASE_URL` at the local PostgreSQL, run the same `db:deploy` / `db:seed`.
No code change. The remainder of this section describes the private-IP/VPC
alternative, which is not in use.


Recommended staged configuration: **private-IP Cloud SQL + App Hosting Direct
VPC egress**. Do not expose PostgreSQL to `0.0.0.0/0`.

1. Select/create the approved VPC and a regional subnet matching App Hosting.
   Configure [private services access][private-access] with a non-overlapping
   allocated range, then create Cloud SQL with private IP only.
2. Configure [App Hosting VPC access][vpc] through the template
   `docs/apphosting.cloud-sql.example.yaml`. Confirm subnet capacity, routing,
   the required network permissions for the documented service identities,
   and firewall access to PostgreSQL on 5432. Do not grant project-wide Owner
   or Editor just to bypass a networking error.
3. Require encrypted connections on Cloud SQL. For a direct Prisma TLS
   connection, provide the correct trusted server CA file, use `sslmode=require`
   and `sslaccept=strict`, and test certificate validation from the target runtime.
   Prisma's certificate file parameters and paths are documented [here][prisma].
   With hostname-validated certificates, use the matching DNS name resolving
   to the private address. If client certificates are required, provision them
   and mount them securely too. Do not bypass verification to make a test pass.
4. Provision a dedicated database, e.g. `schoolcircle_demo`, and separate
   `schoolcircle_migrator` and `schoolcircle_app` database roles. The migration
   role owns this database's schema; the app role gets only CONNECT, schema
   USAGE, and SELECT/INSERT/UPDATE/DELETE on application tables.
   Neither application nor migration credentials should have superuser,
   CREATEROLE, or instance-wide administration.
5. Restrict schema CREATE privileges to the migration role. Configure default
   privileges **for that role** so future migrations grant app-table DML to
   the app role. Do not grant app DML on Prisma's migration-history table.
   Use a separate read-only role for readers that need no writes.
6. Store the runtime URL in Secret Manager as
   `schoolcircle-dev-database-url`, with a percent-encoded password and
   `schema=public&connection_limit=5&pool_timeout=10` plus the verified TLS
   parameters. Never put its value in Git, issue comments, screenshots, shell
   command arguments, or logs. A URL shape, **not a usable credential**, is:

   ```text
   postgresql://APP_USER:ENCODED_PASSWORD@PRIVATE_DB_HOST:5432/schoolcircle_demo?schema=public&connection_limit=5&pool_timeout=10&sslmode=require&sslaccept=strict&sslcert=SERVER_CA_PATH
   ```

7. Use Firebase's secure secret prompt (`firebase apphosting:secrets:set
   schoolcircle-dev-database-url --project schoolcircle-ae29a`) or the Secret
   Manager console; grant access only to the intended backend via Firebase's
   `apphosting:secrets:grantaccess` flow. Follow the installed CLI's prompts/help
   for backend selection. Pin an approved version for a controlled rollout if
   required; preserve a rollback version.
8. Keep migrator credentials separate and available only to the release
   operator/job. Do not give them to the running Next.js service.

The template caps the backend at two instances and the example URL caps each
Prisma pool at five connections. Allow extra capacity for revision overlap,
migrations and administrators; check the actual instance's connection budget.
Use the existing Prisma singleton rather than creating a client per request.

Private VPC access exists **at runtime, not during App Hosting builds**.
Do not make build-time database queries or run migrations in the build/start
command. Run migrations once from an approved operator host or job with VPC
reachability. An authorized Cloud SQL Auth Proxy can also be used from such a
host (`--private-ip`); it does not magically grant Replit access to a private
VPC. Proxy connections authenticate to Google and encrypt the upstream link;
keep its local listener loopback-only and do not reuse a plaintext proxy URL
for a direct remote connection.

## 3. Migrations: confirm the target, never reset

The committed initial migration creates the schema already described by Prisma.
It is intended for an **empty database**. Check for existing tables and migration
history first using a read-only connection.

- Empty database: run the committed migration with the migrator role.
- Existing tables without migration history: stop, back up, and compare the
  actual schema with the initial migration. Baseline only after an operator
  verifies an exact match; do not blindly mark a migration as applied.
- Existing migration history: inspect it and reconcile with the PR before
  applying anything. Never use `migrate reset` or `db push --force-reset`.

Database scripts load Next's `.env.local` conventions while respecting variables
already supplied by the operator. Configure credentials through the environment,
not inline in shell history.

```bash
# DATABASE_URL is securely injected with the migrator credential.
# These are non-secret target acknowledgments, not credentials:
export SCHOOLCIRCLE_DB_ENV=demo
export DATABASE_TARGET_CONFIRM=schoolcircle_demo
npm run db:status     # A new/pending migration returns a nonzero status.
npm run db:deploy     # Applies committed migrations; never automatically seeds.
```

Detailed child-process errors are suppressed because Prisma diagnostics can
contain credentials. On failure, use a secure operator session to inspect
connectivity and migration status; do not paste raw errors into public logs.
`DATABASE_TARGET_CONFIRM` is an accidental-target guard, not authorization.
Bypassing the wrapper with raw Prisma commands bypasses that guard.

## 4. Deliberate demo seeding only

Only a disposable, isolated development/demo/test database may be seeded.
Required conditions: non-production `NODE_ENV`, `SCHOOLCIRCLE_DB_ENV` explicitly
`development`, `demo` or `test`, database name ending `_dev`, `_demo` or `_test`,
`DATABASE_TARGET_CONFIRM` matching that database name, and `ALLOW_DEMO_SEED=true`.
The seed transaction refuses non-demo domain rows.
These guards are not a replacement for verifying the actual host/database.

```bash
export SCHOOLCIRCLE_DB_ENV=demo
export DATABASE_TARGET_CONFIRM=schoolcircle_demo
export NODE_ENV=development
export ALLOW_DEMO_SEED=true
npm run db:seed
unset ALLOW_DEMO_SEED
```

The seed uses reserved stable demo IDs, generic demo users with no external
authentication identity, and a transaction. Demo fixtures include approved
items so the existing learner read model can be demonstrated; **they are not
production instructor approvals or evidence of a verification run**.
Do not run this against real learner data or a live shared database.

Issue #4 still owns persistence UI/actions. This PR's PostgreSQL test writes
an attempt directly and reconnects to read it; that is not an end-to-end
claim about the learner submission UI.

## 5. Local hardware / offline

On hardware with Docker available (not inside Replit):

```bash
docker compose up -d
cp .env.example .env.local
npm ci
npm run db:deploy
NODE_ENV=development ALLOW_DEMO_SEED=true npm run db:seed
npm run dev
```

Alternatively use native PostgreSQL 16; create `schoolcircle_dev` with a
local-only login and point the URL at it. The compose development password is
for loopback-only demo use, not cloud or shared-network deployment.
If an existing compose volume was initialized under the old database name,
changing `POSTGRES_DB` won't rename it. Create the new database deliberately or
point the URL at the intended old database; do not delete the volume to fix it.
The seed guards intentionally refuse the old unqualified name.

Keep `provider = "postgresql"`; SQLite is not a connection-string-only swap.
Cloud and local databases are independent. Apply the same migrations and
explicit demo seed, or use an approved export/restore procedure for real data.
No automatic synchronization is included.

For an actual offline test, cache/install runtime dependencies first, provide
local model/Anchor services if those features are needed, then disconnect the
hardware's network. Existing Firebase cloud sign-in does not work offline;
use the app's existing explicitly documented unconfigured/demo behavior for
this test, not a purported offline Google login. Production auth design is
outside this PR.

## 6. Verification and rollout checklist

- `npm run test:db-policy`: no database needed; seed safety-policy regression tests.
- `npm run test:db`: native PostgreSQL 16 binaries on PATH; creates its own
  private temporary cluster, never uses the workspace's existing DATABASE_URL.
  Applies migrations twice, seeds twice, verifies reconnect persistence and
  rejection of real-data/production seeding, and checks schema drift.
- `npm run build`: no live database connection required.
- After separate rollout approval: merge the verified VPC/secret settings into
  App Hosting configuration, confirm migrations and grants, deploy the approved
  PR revision, then verify `/api/courses` returns the seeded course and only
  APPROVED items. Verify writes through the UI once issue #4 is implemented.
- Verify persistence after a service restart and test hardware offline separately.
- Do not close #26 as fully delivered until its cloud and hardware checks pass.

[pricing]: https://cloud.google.com/sql/pricing
[private-access]: https://cloud.google.com/sql/docs/postgres/configure-private-services-access
[vpc]: https://firebase.google.com/docs/app-hosting/vpc-network
[prisma]: https://www.prisma.io/docs/orm/v6/overview/databases/postgresql