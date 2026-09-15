/**
 * A deliberately small HTTP adapter for the legacy route contracts.
 *
 * The API server artifacts use Express' route/middleware vocabulary, but the
 * Next application must not start a second HTTP server. This registry keeps
 * the route contracts and middleware ordering while executing them directly
 * from a Next Request and returning a native Response.
 */

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

export function Router() {
  return new RouteRegistry();
}

class RouteRegistry {
  constructor() {
    this.routes = [];
  }

  get(path, ...handlers) {
    return this.route('GET', path, handlers);
  }

  post(path, ...handlers) {
    return this.route('POST', path, handlers);
  }

  put(path, ...handlers) {
    return this.route('PUT', path, handlers);
  }

  patch(path, ...handlers) {
    return this.route('PATCH', path, handlers);
  }

  delete(path, ...handlers) {
    return this.route('DELETE', path, handlers);
  }

  route(method, path, handlers) {
    if (!METHODS.has(method) || typeof path !== 'string') {
      throw new TypeError('A valid HTTP method and route path are required');
    }
    const flattened = handlers.flat(Infinity).filter(Boolean);
    if (!flattened.every((handler) => typeof handler === 'function')) {
      throw new TypeError(`Invalid middleware for ${method} ${path}`);
    }
    this.routes.push({
      method,
      path: normalizePath(path),
      handlers: flattened,
    });
    return this;
  }

  /**
   * Mount another registry. A registry passed without a path retains its
   * paths, while a path prefix is added to every mounted contract.
   */
  use(prefixOrRouter, maybeRouter) {
    const hasPrefix = typeof prefixOrRouter === 'string';
    const prefix = hasPrefix ? normalizePath(prefixOrRouter) : '';
    const child = hasPrefix ? maybeRouter : prefixOrRouter;
    if (!child || !Array.isArray(child.routes)) {
      throw new TypeError('Router.use expects a route registry');
    }
    for (const route of child.routes) {
      this.routes.push({
        ...route,
        path: normalizePath(`${prefix}/${route.path}`),
      });
    }
    return this;
  }
}

function normalizePath(path) {
  const value = String(path || '/').replace(/\/+/g, '/');
  if (value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

function compilePath(path) {
  const params = [];
  const source = normalizePath(path)
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) {
        params.push(segment.slice(1));
        return '([^/]+)';
      }
      if (segment === '*') {
        params.push('0');
        return '(.*)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return {
    params,
    regex: new RegExp(`^/${source}${source ? '/?' : ''}$`),
  };
}

function matchRoute(route, path) {
  const compiled = route.compiled || (route.compiled = compilePath(route.path));
  const match = compiled.regex.exec(normalizePath(path));
  if (!match) return null;
  return Object.fromEntries(
    compiled.params.map((name, index) => [name, decodeURIComponent(match[index + 1])]),
  );
}

function headersObject(request) {
  const output = {};
  request.headers.forEach((value, key) => {
    output[key.toLowerCase()] = value;
  });
  const url = new URL(request.url);
  if (!output.host) output.host = url.host;
  if (!output['x-forwarded-proto']) output['x-forwarded-proto'] = url.protocol.slice(0, -1);
  return output;
}

const SMALL_BODY_LIMIT = 4 * 1024 * 1024;
const MULTIPART_BODY_LIMIT = 20 * 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor(limit) {
    super(`Request body exceeds the ${Math.floor(limit / (1024 * 1024))} MB limit`);
    this.name = 'PayloadTooLargeError';
    this.code = 'PAYLOAD_TOO_LARGE';
    this.status = 413;
  }
}

function declaredLength(request) {
  const value = request.headers.get('content-length');
  if (value == null || value.trim() === '') return null;
  const length = Number(value);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

/**
 * Read a request body in chunks, enforcing the limit against actual bytes.
 * Content-Length is only an early rejection hint: a missing, false, or
 * under-reported header can never bypass the reader count.
 */
async function readBodyBytes(request, limit) {
  const declared = declaredLength(request);
  if (declared != null && declared > limit) throw new PayloadTooLargeError(limit);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new PayloadTooLargeError(limit);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function multipartHeaders(request) {
  const headers = new Headers(request.headers);
  // A forged original length must not make the bounded copy fail while it is
  // being handed back to the platform FormData parser.
  headers.delete('content-length');
  return headers;
}

async function parseBody(request, { multipart = false } = {}) {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return { body: {}, fields: {} };
  }
  const contentType = request.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('multipart/form-data')) {
    if (!multipart) return { body: {}, fields: {} };
    const boundedBytes = await readBodyBytes(request, MULTIPART_BODY_LIMIT);
    const formRequest = new Request(request.url, {
      method: request.method,
      headers: multipartHeaders(request),
      body: boundedBytes,
    });
    const form = await formRequest.formData();
    const body = {};
    const files = {};
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') {
        body[name] = value;
      } else {
        const bytes = await value.arrayBuffer();
        const file = {
          fieldname: name,
          originalname: value.name || 'upload',
          filename: value.name || 'upload',
          mimetype: value.type || 'application/octet-stream',
          size: bytes.byteLength,
          buffer: Buffer.from(bytes),
        };
        (files[name] ||= []).push(file);
      }
    }
    return { body, fields: body, file: files.file?.[0] || null, files };
  }
  if (contentType.toLowerCase().includes('application/json')) {
    const bytes = await readBodyBytes(request, SMALL_BODY_LIMIT);
    try {
      const body = JSON.parse(new TextDecoder().decode(bytes));
      return { body: body && typeof body === 'object' ? body : {}, fields: {} };
    } catch {
      return { body: {}, fields: {} };
    }
  }
  if (contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const bytes = await readBodyBytes(request, SMALL_BODY_LIMIT);
    const values = new URLSearchParams(new TextDecoder().decode(bytes));
    return { body: Object.fromEntries(values), fields: {} };
  }
  if (!request.body) return { body: {}, fields: {} };
  await readBodyBytes(request, SMALL_BODY_LIMIT);
  return { body: {}, fields: {} };
}

function cookieValue(value) {
  return encodeURIComponent(String(value));
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${cookieValue(value)}`];
  if (options.maxAge != null && Number.isFinite(Number(options.maxAge))) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(Number(options.maxAge) / 1000))}`);
  }
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires instanceof Date) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) {
    const sameSite = String(options.sameSite).toLowerCase();
    parts.push(`SameSite=${sameSite === 'strict' ? 'Strict' : sameSite === 'none' ? 'None' : 'Lax'}`);
  }
  return parts.join('; ');
}

function createResponse() {
  let statusCode = 200;
  let body;
  const headers = new Headers();
  const cookies = [];
  let headersSent = false;
  const response = {
    get headersSent() {
      return headersSent;
    },
    status(value) {
      statusCode = Number(value) || 500;
      return response;
    },
    set(name, value) {
      if (name && typeof name === 'object') {
        for (const [key, headerValue] of Object.entries(name)) {
          if (headerValue != null) headers.set(String(key), String(headerValue));
        }
        return response;
      }
      if (name && value != null) headers.set(String(name), String(value));
      return response;
    },
    header(name, value) {
      return response.set(name, value);
    },
    type(value) {
      const type = String(value);
      headers.set('content-type', type.includes('/') ? type : `${type}; charset=utf-8`);
      return response;
    },
    cookie(name, value, options) {
      cookies.push(serializeCookie(name, value, options));
      return response;
    },
    clearCookie(name, options = {}) {
      cookies.push(serializeCookie(name, '', { ...options, maxAge: 0 }));
      return response;
    },
    json(value) {
      body = JSON.stringify(value);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
      headersSent = true;
      return response;
    },
    send(value) {
      body = value;
      headersSent = true;
      return response;
    },
    end(value) {
      return value === undefined ? response : response.send(value);
    },
    redirect(location, code = 302) {
      statusCode = code;
      headers.set('location', String(location));
      body = '';
      headersSent = true;
      return response;
    },
    toResponse() {
      for (const cookie of cookies) headers.append('set-cookie', cookie);
      if (body == null) return new Response(null, { status: statusCode, headers });
      return new Response(body, { status: statusCode, headers });
    },
  };
  return response;
}

function requestFacade(request, pathname, query, params) {
  const headers = headersObject(request);
  return {
    method: request.method,
    url: pathname + new URL(request.url).search,
    originalUrl: pathname + new URL(request.url).search,
    protocol: headers['x-forwarded-proto'] || 'https',
    headers,
    query,
    params,
    body: {},
    file: null,
    files: {},
    _request: request,
    _bodyParsed: false,
    _bodyPromise: null,
  };
}

async function ensureBody(req, { multipart = false } = {}) {
  if (req._bodyParsed) return req;
  if (!req._bodyPromise) {
    req._bodyPromise = parseBody(req._request, { multipart }).then((parsed) => {
      req.body = parsed.body;
      req.file = parsed.file;
      req.files = parsed.files || {};
      req._bodyParsed = true;
      return req;
    });
  }
  await req._bodyPromise;
  return req;
}

function bodyMiddleware(req, res, next) {
  return ensureBody(req).then(
    () => next(),
    (error) => {
      if (error?.status === 413) {
        res.status(413).json({ error: error.message, code: error.code });
        return;
      }
      next(error);
    },
  );
}

function multipartMiddleware(req, res, next) {
  return ensureBody(req, { multipart: true }).then(
    () => next(),
    (error) => {
      if (error?.status === 413) {
        res.status(413).json({ error: error.message, code: error.code });
        return;
      }
      const parseError = error instanceof Error ? error : new Error('Unable to parse multipart body');
      parseError.status = 400;
      parseError.code = parseError.code || 'BAD_REQUEST';
      next(parseError);
    },
  );
}

async function runMiddleware(handlers, req, res) {
  let cursor = -1;
  const run = async (index, error) => {
    if (index <= cursor) return;
    cursor = index;
    if (error) throw error;
    const handler = handlers[index];
    if (!handler) return;
    let proceeded = false;
    let nextError;
    const next = (nextValue) => {
      proceeded = true;
      nextError = nextValue;
    };
    await handler(req, res, next);
    if (proceeded && !res.headersSent) await run(index + 1, nextError);
  };
  await run(0);
}

/**
 * Adapt one Next Request to the selected registry. A route's middleware is
 * executed in registration order, including auth and role checks.
 */
export async function dispatchRequest(request, registry, { prefix = '/api', middleware = [] } = {}) {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length) || '/'
    : url.pathname);
  const method = request.method.toUpperCase();
  const route = registry.routes.find((candidate) => candidate.method === method && matchRoute(candidate, pathname));
  const response = createResponse();
  if (!route) {
    return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  const params = matchRoute(route, pathname);
  const query = Object.fromEntries(url.searchParams.entries());
  const req = requestFacade(request, pathname, query, params);
  const isMultipart = (request.headers.get('content-type') || '')
    .toLowerCase()
    .includes('multipart/form-data');
  // JSON/urlencoded bodies can be prepared after the global auth boundary.
  // Multipart stays untouched until upload.single/fields executes in the
  // route's own middleware order, after role authorization.
  const handlers = [
    ...middleware,
    ...(!isMultipart ? [bodyMiddleware] : []),
    ...route.handlers,
  ];
  try {
    await runMiddleware(handlers, req, response);
  } catch (error) {
    if (!response.headersSent) {
      response.status(Number(error?.status) || 500).json({
        error: error?.message || 'Request failed',
        code: error?.code || 'ERROR',
      });
    }
  }
  return response.toResponse();
}

/**
 * Multer-compatible lazy upload middleware. Parsing starts only when a route
 * reaches its upload middleware, after any auth/role handlers registered
 * before it.
 */
export const upload = {
  single() {
    return multipartMiddleware;
  },
  fields() {
    return multipartMiddleware;
  },
  any() {
    return multipartMiddleware;
  },
  none() {
    return multipartMiddleware;
  },
};

export default Router;