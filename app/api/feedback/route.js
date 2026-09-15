/* Tester feedback → GitHub issue. The PAT lives only on the server; the
   browser just sends the form plus a shared key so the dev URL cannot be used
   to spam the repo. Disabled entirely unless GITHUB_FEEDBACK_TOKEN is set. */

export const runtime = 'nodejs';

const REPO = process.env.GITHUB_FEEDBACK_REPO || 'groundworklms/SchoolCircleLMS';
const TYPES = {
  bug: ['bug', 'qa'],
  enhancement: ['enhancement', 'qa'],
  idea: ['enhancement', 'qa'],
  question: ['question', 'qa'],
};

export async function POST(req) {
  const token = process.env.GITHUB_FEEDBACK_TOKEN;
  if (!token) {
    return Response.json({ error: 'Feedback is not configured on this deployment' }, { status: 503 });
  }
  const key = process.env.FEEDBACK_KEY;
  if (key && req.headers.get('x-feedback-key') !== key) {
    return Response.json({ error: 'Bad team key' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) return Response.json({ error: 'Title is required' }, { status: 400 });
  const type = TYPES[body.type] ? body.type : 'bug';
  const description = String(body.description || '').trim().slice(0, 10000);
  const ctx = body.context || {};
  // Reports are attributed to the PAT owner on GitHub, so the reporter's name
  // in the body is the only thing that says who actually filed it.
  const reporter = String(ctx.reporter || '').trim().slice(0, 80);
  if (!reporter) return Response.json({ error: 'Reporter name is required' }, { status: 400 });

  const issueBody = [
    description || '_No description given._',
    '',
    '---',
    '<details><summary>Context (auto-captured by in-app widget)</summary>',
    '',
    '| | |',
    '|---|---|',
    `| Where | ${ctx.where || '?'} |`,
    `| URL | ${ctx.url || '?'} |`,
    `| Build | ${ctx.build || 'unknown'} |`,
    `| Viewport | ${ctx.viewport || '?'} |`,
    `| Browser | ${ctx.userAgent || '?'} |`,
    `| Reporter | ${reporter} |`,
    `| Time | ${new Date().toISOString()} |`,
    '',
    '</details>',
  ].join('\n');

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ title, body: issueBody, labels: TYPES[type] }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[feedback] GitHub error', res.status, data);
      return Response.json({ error: data.message || `GitHub returned ${res.status}` }, { status: 502 });
    }
    return Response.json({ number: data.number, url: data.html_url });
  } catch (err) {
    console.error('[feedback]', err);
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
