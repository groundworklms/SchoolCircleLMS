import { Router } from 'express';
import multer from 'multer';
import { parsePoi } from '../lib/poi-parser.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/ingest', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const buf = new Uint8Array(file.buffer);
    const started = Date.now();
    const parsed = await parsePoi(buf);
    res.json({
      ...parsed,
      sourceDoc: file.originalname,
      parseMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[ingest]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;