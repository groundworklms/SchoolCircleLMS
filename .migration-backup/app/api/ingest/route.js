import { parsePoi } from '../../../lib/poi-parser';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return Response.json({ error: 'No file uploaded' }, { status: 400 });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const started = Date.now();
    const parsed = await parsePoi(buf);
    return Response.json({
      ...parsed,
      sourceDoc: file.name,
      parseMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[ingest]', err);
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
