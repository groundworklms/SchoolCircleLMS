// @ts-nocheck
import { Router } from "express";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const router = Router();

function planPath() {
  const candidates = [
    path.resolve(process.cwd(), "PLAN.md"),
    path.resolve(process.cwd(), "../../PLAN.md"),
    path.resolve(process.cwd(), ".migration-backup/PLAN.md"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

router.get("/plan", async (_req, res) => {
  const filePath = planPath();
  try {
    const [content, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return res
      .set("Cache-Control", "no-store")
      .json({ content, mtime: info.mtimeMs });
  } catch (err) {
    return res
      .set("Cache-Control", "no-store")
      .json({
        content: `# PLAN.md not found\n\nExpected it at \`${filePath}\`.`,
        mtime: 0,
        error: String(err),
      });
  }
});

export default router;