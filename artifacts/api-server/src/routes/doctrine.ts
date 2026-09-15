// @ts-nocheck
import { Router } from "express";
import { askDoctrine, doctrineProvider } from "../lib/doctrine";

const router = Router();

router.get("/doctrine", (_req, res) => {
  res.json(doctrineProvider());
});

router.post("/doctrine", async (req, res) => {
  try {
    const { question } = req.body ?? {};
    if (!question) {
      return res.status(400).json({ error: "question is required" });
    }

    const started = Date.now();
    const out = await askDoctrine({ question });
    return res.json({ ...out, ms: Date.now() - started });
  } catch (err) {
    const status =
      err.code === "NO_DOCTRINE_SERVICE" ? 503 :
      err.code === "DOCTRINE_UNREACHABLE" ? 502 :
      err.code === "DOCTRINE_BAD_RESPONSE" ? 502 :
      err.code === "DOCTRINE_ERROR" ? 502 :
      err.code === "BAD_REQUEST" ? 400 : 500;
    console.error("[doctrine]", err.message);
    return res.status(status).json({ error: err.message, code: err.code || "ERROR" });
  }
});

export default router;