import { askDoctrine, doctrineProvider } from '../../../lib/doctrine';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Status, so the capabilities screen can show whether grounding is actually available. */
export async function GET() {
  return Response.json(doctrineProvider());
}

export async function POST(req) {
  try {
    const { question } = await req.json();
    if (!question) {
      return Response.json({ error: 'question is required' }, { status: 400 });
    }

    const started = Date.now();
    const out = await askDoctrine({ question });

    // An abstention returns 200. It is a correct, useful answer to a question the corpus
    // cannot support, and the UI should render it as such — returning 4xx/5xx here would
    // push callers toward a catch block and an ungrounded retry, which is the one thing
    // this endpoint exists to prevent.
    return Response.json({ ...out, ms: Date.now() - started });
  } catch (err) {
    const status =
      err.code === 'NO_DOCTRINE_SERVICE' ? 503
      : err.code === 'DOCTRINE_UNREACHABLE' ? 502
      : err.code === 'DOCTRINE_BAD_RESPONSE' ? 502
      : err.code === 'DOCTRINE_ERROR' ? 502
      : err.code === 'BAD_REQUEST' ? 400
      : 500;
    console.error('[doctrine]', err.message);
    return Response.json({ error: err.message, code: err.code || 'ERROR' }, { status });
  }
}
