import { Router } from 'express';
import { askDoctrine, doctrineProvider } from '../lib/doctrine.js';

const router = Router();

/** Status, so the capabilities screen can show whether grounding is actually available. */
router.get('/doctrine', (_req, res) => {
  res.json(doctrineProvider());
});

router.post('/doctrine', async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question) {
      res.status(400).json({ error: 'question is required' });
      return;
    }

    const started = Date.now();
    const out = await askDoctrine({ question });

    // An abstention returns 200. It is a correct, useful answer to a question the corpus
    // cannot support, and the UI should render it as such — returning 4xx/5xx here would
    // push callers toward a catch block and an ungrounded retry, which is the one thing
    // this endpoint exists to prevent.
    res.json({ ...out, ms: Date.now() - started });
  } catch (err) {
    const status =
      err.code === 'NO_DOCTRINE_SERVICE' ? 503
      : err.code === 'DOCTRINE_UNREACHABLE' ? 502
      : err.code === 'DOCTRINE_BAD_RESPONSE' ? 502
      : err.code === 'DOCTRINE_ERROR' ? 502
      : err.code === 'BAD_REQUEST' ? 400
      : 500;
    console.error('[doctrine]', err.message);
    res.status(status).json({ error: err.message, code: err.code || 'ERROR' });
  }
});

export default router;