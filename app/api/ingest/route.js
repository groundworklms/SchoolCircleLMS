import { parsePoi } from '../../../lib/poi-parser';
import { readPdfUpload } from '../../../lib/pdf-upload';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const buf = await readPdfUpload(file);
    const started = Date.now();
    const parsed = await parsePoi(buf);
    return Response.json({
      ...parsed,
      sourceDoc: file.name,
      parseMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[ingest]', err);
    const status = err?.code === 'BAD_REQUEST' || err instanceof TypeError ? 400 : 500;
    return Response.json({ error: String(err?.message || err) }, { status });
  }
}
