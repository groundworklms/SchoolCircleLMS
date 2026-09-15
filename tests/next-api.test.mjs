import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchRequest, Router, upload } from '../lib/server/router.js';

const API_ORIGIN = 'https://schoolcircle.example.test';

function jsonRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(`${API_ORIGIN}/api${path}`, {
    ...options,
    headers,
    ...(options.body !== undefined && typeof options.body !== 'string'
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
}

async function jsonBody(response) {
  return response.json();
}

async function importOrSkip(t, specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') {
      t.skip(`root API dependencies are not installed: ${error.message}`);
      return null;
    }
    throw error;
  }
}

function withEnv(values, callback) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test('native dispatcher returns 401 for a protected learning endpoint', async (t) => {
  const integration = await importOrSkip(t, '../lib/server/integration.js');
  if (!integration) return;

  const response = await dispatchRequest(
    jsonRequest('/learning/sources', {
      method: 'GET',
      headers: {
        // Header claims must not create an identity.
        'x-user': 'attacker',
        'x-role': 'INSTRUCTOR',
      },
    }),
    integration.registry,
    { middleware: [integration.authBoundary] },
  );

  assert.equal(response.status, 401);
  assert.equal((await jsonBody(response)).code, 'AUTH_REQUIRED');
});

test('learner role is denied an instructor mutation without trusting request claims', async (t) => {
  const auth = await importOrSkip(t, '../lib/server/auth.js');
  if (!auth) return;
  const authBoundary = await importOrSkip(t, '../lib/server/auth-boundary.js');
  if (!authBoundary) return;
  const dbModule = await importOrSkip(t, '../lib/server/db.js');
  if (!dbModule) return;
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is required for the isolated role fixture');
    return;
  }

  const externalId = `next-api-fixture-${process.pid}-${Date.now()}`;
  let learner;
  let mutationRan = false;

  try {
    learner = await dbModule.db.user.create({
      data: {
        name: 'Native API fixture learner',
        role: 'LEARNER',
        externalId,
      },
    });
    const registry = Router();
    registry.post(
      '/instructor-mutation',
      // This is the trusted server-side output that authBoundary normally
      // supplies. It is deliberately not read from a request header/body.
      (req, _res, next) => {
        req.user = { id: learner.id };
        next();
      },
      ...auth.requireRole('INSTRUCTOR'),
      upload.single('file'),
      () => {
        mutationRan = true;
      },
    );

    let readerPulls = 0;
    const body = new ReadableStream({
      pull(controller) {
        readerPulls += 1;
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const request = new Request(`${API_ORIGIN}/api/instructor-mutation`, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=fixture',
        // A client role claim must not affect the server-side role lookup.
        'x-role': 'INSTRUCTOR',
      },
      body,
      duplex: 'half',
    });
    // Undici may prefetch one chunk while constructing a streaming Request;
    // reset that transport detail so this assertion observes adapter reads.
    await new Promise((resolve) => setImmediate(resolve));
    readerPulls = 0;
    let parserInvoked = false;
    const originalUpload = upload.single;
    upload.single = (...args) => {
      parserInvoked = true;
      return originalUpload(...args);
    };
    try {
      const response = await dispatchRequest(
        request,
        registry,
        { middleware: [authBoundary.authBoundary] },
      );

      assert.equal(response.status, 403);
      assert.equal((await jsonBody(response)).code, 'FORBIDDEN');
      assert.equal(mutationRan, false);
      assert.equal(parserInvoked, false);
      assert.equal(readerPulls, 0);
    } finally {
      upload.single = originalUpload;
    }
  } finally {
    if (learner) {
      await dbModule.db.user.delete({ where: { id: learner.id } });
    }
  }
});

test('malformed JSON reaches the native handler as an explicit 400', async (t) => {
  const integration = await importOrSkip(t, '../lib/server/integration.js');
  if (!integration) return;

  const response = await dispatchRequest(
    new Request(`${API_ORIGIN}/api/doctrine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"question":',
    }),
    integration.registry,
    { middleware: [integration.authBoundary] },
  );

  assert.equal(response.status, 400);
  assert.equal((await jsonBody(response)).error, 'question is required');
});

test('JSON body limits count actual bytes with missing and false Content-Length', async () => {
  for (const contentLength of [undefined, '0']) {
    let handlerRan = false;
    const registry = Router();
    registry.post('/bounded-json', () => {
      handlerRan = true;
    });

    const headers = { 'content-type': 'application/json' };
    if (contentLength !== undefined) headers['content-length'] = contentLength;
    const bytes = new Uint8Array(4 * 1024 * 1024 + 1);
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const response = await dispatchRequest(
      new Request(`${API_ORIGIN}/api/bounded-json`, {
        method: 'POST',
        headers,
        body,
        duplex: 'half',
      }),
      registry,
    );

    assert.equal(response.status, 413);
    assert.equal((await jsonBody(response)).code, 'PAYLOAD_TOO_LARGE');
    assert.equal(handlerRan, false);
  }
});

test('multipart body has a bounded lazy reader and returns 413 before upload handler', async () => {
  let handlerRan = false;
  const registry = Router();
  registry.post('/bounded-upload', upload.single('file'), () => {
    handlerRan = true;
  });

  const bytes = new Uint8Array(20 * 1024 * 1024 + 1);
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const response = await dispatchRequest(
    new Request(`${API_ORIGIN}/api/bounded-upload`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=fixture' },
      body,
      duplex: 'half',
    }),
    registry,
  );

  assert.equal(response.status, 413);
  assert.equal((await jsonBody(response)).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(handlerRan, false);
});

test('multipart File values become native route request files', async () => {
  const registry = Router();
  registry.post('/upload', upload.single('file'), (req, res) => {
    res.json({
      field: req.file?.fieldname,
      name: req.file?.originalname,
      mime: req.file?.mimetype,
      bytes: req.file?.buffer?.length,
      title: req.body?.title,
    });
  });

  const form = new FormData();
  form.append('title', 'Native upload');
  form.append('file', new Blob(['source bytes'], { type: 'text/plain' }), 'source.txt');
  const response = await dispatchRequest(
    new Request(`${API_ORIGIN}/api/upload`, { method: 'POST', body: form }),
    registry,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await jsonBody(response), {
    field: 'file',
    name: 'source.txt',
    mime: 'text/plain',
    bytes: 12,
    title: 'Native upload',
  });
});

test('native responses preserve binary ZIP and ICS content', async () => {
  const registry = Router();
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x10, 0x20]);
  registry.get('/export.zip', (_req, res) => {
    res.type('application/zip').set('Content-Disposition', 'attachment; filename="course.zip"').send(zip);
  });
  registry.get('/study-plan.ics', (_req, res) => {
    res.type('text/calendar').send('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  });

  const zipResponse = await dispatchRequest(
    new Request(`${API_ORIGIN}/api/export.zip`),
    registry,
  );
  assert.equal(zipResponse.status, 200);
  assert.equal(zipResponse.headers.get('content-type'), 'application/zip');
  assert.match(zipResponse.headers.get('content-disposition'), /course\.zip/);
  assert.deepEqual(Array.from(new Uint8Array(await zipResponse.arrayBuffer())), Array.from(zip));

  const icsResponse = await dispatchRequest(
    new Request(`${API_ORIGIN}/api/study-plan.ics`),
    registry,
  );
  assert.equal(icsResponse.status, 200);
  assert.equal(icsResponse.headers.get('content-type'), 'text/calendar');
  assert.equal(await icsResponse.text(), 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
});

test('redirect responses retain multiple Set-Cookie headers', async () => {
  const registry = Router();
  registry.get('/login', (_req, res) => {
    res
      .cookie('oidc_state', 'state-value', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600000 })
      .cookie('oidc_nonce', 'nonce-value', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600000 })
      .redirect('https://issuer.example.test/authorize');
  });

  const response = await dispatchRequest(new Request(`${API_ORIGIN}/api/login`), registry);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://issuer.example.test/authorize');
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') || '').split(/,\s*(?=[^;=]+=)/);
  assert.equal(setCookies.length, 2);
  assert.match(setCookies[0], /^oidc_state=state-value/);
  assert.match(setCookies[1], /^oidc_nonce=nonce-value/);
  assert.match(setCookies[0], /HttpOnly/);
  assert.match(setCookies[1], /SameSite=Lax/);
});

test('native request fields match authBoundary origin and CSRF expectations', async (t) => {
  const oidc = await importOrSkip(t, '../lib/server/oidc.js');
  if (!oidc) return;
  const authBoundary = await importOrSkip(t, '../lib/server/auth-boundary.js');
  if (!authBoundary) return;
  const session = await importOrSkip(t, '../lib/server/session.js');
  if (!session) return;

  await withEnv(
    {
      NODE_ENV: 'production',
      AUTH_ALLOWED_HOSTS: 'schoolcircle.example.test',
      AUTH_ALLOWED_ORIGINS: 'https://schoolcircle.example.test',
      REPLIT_DOMAINS: undefined,
      REPLIT_DEV_DOMAIN: undefined,
      REPLIT_DEPLOYMENT_DOMAIN: undefined,
      APP_ORIGIN: undefined,
    },
    async () => {
      assert.equal(oidc.isTrustedCorsOrigin('https://schoolcircle.example.test'), true);
      assert.equal(oidc.isTrustedCorsOrigin('https://attacker.example.test'), false);
      assert.equal(oidc.isTrustedCorsOrigin('null'), false);

      let reflectedOrigin;
      oidc.corsOrigin('https://schoolcircle.example.test', (_error, value) => {
        reflectedOrigin = value;
      });
      assert.equal(reflectedOrigin, 'https://schoolcircle.example.test');
      oidc.corsOrigin('https://attacker.example.test', (_error, value) => {
        reflectedOrigin = value;
      });
      assert.equal(reflectedOrigin, false);

      const registry = Router();
      registry.post('/request-fields/:id', (req, res) => {
        res.json({
          method: req.method,
          id: req.params.id,
          query: req.query.courseId,
          origin: req.headers.origin,
          sameOrigin: oidc.sameOriginRequest(req),
          forwardedHost: req.headers['x-forwarded-host'] || null,
        });
      });

      const sameOrigin = await dispatchRequest(
        new Request(`${API_ORIGIN}/api/request-fields/abc?courseId=course-1`, {
          method: 'POST',
          headers: {
            origin: API_ORIGIN,
            'x-forwarded-host': 'schoolcircle.example.test',
          },
          body: '{}',
        }),
        registry,
      );
      assert.deepEqual(await jsonBody(sameOrigin), {
        method: 'POST',
        id: 'abc',
        query: 'course-1',
        origin: API_ORIGIN,
        sameOrigin: true,
        forwardedHost: 'schoolcircle.example.test',
      });

      const crossOrigin = await dispatchRequest(
        new Request(`${API_ORIGIN}/api/request-fields/abc`, {
          method: 'POST',
          headers: { origin: 'https://attacker.example.test' },
          body: '{}',
        }),
        registry,
      );
      assert.equal((await jsonBody(crossOrigin)).sameOrigin, false);

      const noOrigin = await dispatchRequest(
        new Request(`${API_ORIGIN}/api/request-fields/abc`, {
          method: 'POST',
          body: '{}',
        }),
        registry,
      );
      assert.equal((await jsonBody(noOrigin)).sameOrigin, false);

      // A valid signed cookie is still rejected before Prisma resolution when
      // the browser origin is cross-site. The token has no role claim.
      const csrfResponse = await withEnv(
        { SESSION_SECRET: 'native-next-api-test-secret' },
        async () => {
          const token = session.createSessionToken({
            userId: 'unresolved-csrf-fixture',
            subject: 'oidc-csrf-fixture',
            profile: { role: 'INSTRUCTOR' },
          });
          return dispatchRequest(
            new Request(`${API_ORIGIN}/api/request-fields/abc`, {
              method: 'POST',
              headers: {
                cookie: `sid=${encodeURIComponent(token)}`,
                origin: 'https://attacker.example.test',
              },
              body: '{}',
            }),
            registry,
            { middleware: [authBoundary.authBoundary] },
          );
        },
      );
      assert.equal(csrfResponse.status, 403);
      assert.equal((await jsonBody(csrfResponse)).code, 'CSRF_ORIGIN_MISMATCH');
    },
  );
});