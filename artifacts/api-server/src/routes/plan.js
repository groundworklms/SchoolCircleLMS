import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';

const router = Router();
// The server is bundled at artifacts/api-server/dist/index.mjs in both environments.
const PLAN_PATH = fileURLToPath(new URL('../../../PLAN.md', import.meta.url));

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