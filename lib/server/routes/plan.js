import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Router } from '../router.js';

const router = Router();
// Next bundles route modules under .next/server, so resolve the repository
// contract from the process root rather than from the compiled chunk URL.
const PLAN_PATH = path.join(process.cwd(), 'PLAN.md');

router.get('/plan', async (_req, res) => {
  try {
    const [content, info] = await Promise.all([
      readFile(PLAN_PATH, 'utf8'),
      stat(PLAN_PATH),
    ]);
    res
      .set('Cache-Control', 'no-store')
      .json({ content, mtime: info.mtimeMs });
  } catch (err) {
    res
      .status(200)
      .set('Cache-Control', 'no-store')
      .json({
        content: `# PLAN.md not found\n\nExpected it at \`${PLAN_PATH}\`.`,
        mtime: 0,
        error: String(err),
      });
  }
});

export default router;