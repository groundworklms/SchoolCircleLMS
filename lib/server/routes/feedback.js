/* Tester feedback → GitHub issue. The PAT lives only on the server; the
   browser just sends the form plus a shared key so the dev URL cannot be used
   to spam the repo. Disabled entirely unless GITHUB_FEEDBACK_TOKEN is set. */

import { Router } from '../router.js';

const REPO = process.env.GITHUB_FEEDBACK_REPO || 'groundworklms/SchoolCircleLMS';
const TYPES = {
  bug: ['bug', 'qa'],
  enhancement: ['enhancement', 'qa'],
  idea: ['enhancement', 'qa'],
  question: ['question', 'qa'],
};

const router = Router();

router.post('/feedback', async (req, res) => {
  const token = process.env.GITHUB_FEEDBACK_TOKEN;
  if (!token) {
    res.status(503).json({ error: 'Feedback is not configured on this deployment' });
    return;
  }

  const key = process.env.FEEDBACK_KEY;
  if (key && req.headers['x-feedback-key'] !== key) {
    res.status(401).json({ error: 'Bad team key' });
    return;
  }

  const body = req.body || {};
  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }

  const type = TYPES[body.type] ? body.type : 'bug';
  const description = String(body.description || '').trim().slice(0, 10000);
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
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
    `| Reporter | ${ctx.reporter || 'anonymous'} |`,
    `| Time | ${new Date().toISOString()} |`,
    '',
    '</details>',
  ].join('\n');

  try {
    const githubResponse = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ title, body: issueBody, labels: TYPES[type] }),
    });
    const data = await githubResponse.json();
    if (!githubResponse.ok) {
      console.error('[feedback] GitHub error', githubResponse.status, data);
      res
        .status(502)
        .json({ error: data.message || `GitHub returned ${githubResponse.status}` });
      return;
    }
    res.json({ number: data.number, url: data.html_url });
  } catch (error) {
    console.error('[feedback]', error);
    res.status(500).json({ error: String(error?.message || error) });
  }
});

export default router;