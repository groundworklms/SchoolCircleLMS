// Local TCP proxy to a Cloud SQL instance, for running migrations/seeds from a laptop.
//
//   CLOUD_SQL_CONNECTION_NAME=project:region:instance npm run db:proxy
//   DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5433/schoolcircle_demo npm run db:deploy
//
// Same mechanism the app uses in App Hosting (Cloud SQL Node connector: IAM-authorised,
// TLS to the instance) but exposed on a loopback port so the Prisma CLI can reach it. The
// connector's own startLocalProxy() only listens on Unix sockets, which Prisma can't use
// on Windows. Auth is Application Default Credentials: `gcloud auth login --update-adc`.
import { createServer } from 'node:net';
import { Connector } from '@google-cloud/cloud-sql-connector';

const instanceConnectionName = process.env.CLOUD_SQL_CONNECTION_NAME;
if (!instanceConnectionName) {
  console.error('Set CLOUD_SQL_CONNECTION_NAME=project:region:instance');
  process.exit(1);
}
const port = Number(process.env.CLOUD_SQL_PROXY_PORT) || 5433;

const connector = new Connector();
const { stream } = await connector.getOptions({
  instanceConnectionName,
  ipType: process.env.CLOUD_SQL_IP_TYPE || 'PUBLIC',
});

const server = createServer((local) => {
  const remote = stream();
  local.pipe(remote);
  remote.pipe(local);
  const drop = () => { local.destroy(); remote.destroy(); };
  local.on('error', drop);
  remote.on('error', drop);
});
server.listen({ host: '127.0.0.1', port }, () => {
  console.log(`Cloud SQL proxy: ${instanceConnectionName} -> 127.0.0.1:${port} (Ctrl+C to stop)`);
});

const stop = () => { server.close(); connector.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
