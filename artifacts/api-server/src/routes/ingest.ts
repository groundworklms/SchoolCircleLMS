// @ts-nocheck
import { Router } from "express";
import multer from "multer";
import { parsePoi } from "../lib/poi-parser";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/ingest", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const started = Date.now();
    const parsed = await parsePoi(new Uint8Array(req.file.buffer));
    return res.json({
      ...parsed,
      sourceDoc: req.file.originalname,
      parseMs: Date.now() - started,
    });
  } catch (err) {
    console.error("[ingest]", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;