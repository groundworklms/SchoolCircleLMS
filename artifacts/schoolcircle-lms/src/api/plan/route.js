import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const PLAN_PATH = path.join(process.cwd(), 'PLAN.md');

export async function GET() {
  try {
    const [content, info] = await Promise.all([
      readFile(PLAN_PATH, 'utf8'),
      stat(PLAN_PATH),
    ]);
    return Response.json(
      { content, mtime: info.mtimeMs },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return Response.json(
      { content: `# PLAN.md not found\n\nExpected it at \`${PLAN_PATH}\`.`, mtime: 0, error: String(err) },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
