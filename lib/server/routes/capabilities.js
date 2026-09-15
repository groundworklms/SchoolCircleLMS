import { Router } from '../router.js';
import { capabilities } from '../providers.js';

const router = Router();

router.get('/capabilities', (_req, res) => {
  const caps = capabilities();
  res.json({
    capabilities: caps,
    ready: caps.filter((c) => c.ready).length,
    total: caps.length,
    blocking: caps.filter((c) => c.critical && !c.ready).map((c) => c.id),
  });
});

export default router;