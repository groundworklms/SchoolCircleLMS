import { primeModelSettings } from '../../../lib/model-settings.js';
import { capabilities } from '../../../lib/providers';

export const runtime = 'nodejs';

export async function GET() {
  await primeModelSettings();
  const caps = capabilities();
  return Response.json({
    capabilities: caps,
    ready: caps.filter((c) => c.ready).length,
    total: caps.length,
    blocking: caps.filter((c) => c.critical && !c.ready).map((c) => c.id),
  });
}
