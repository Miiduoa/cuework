import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { ConflictError, RevisionStore } from './store.ts';
import { LIMITS } from '../src/core.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMITS.bytes * 3) throw new Error('Request exceeds the 3 MiB limit.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('The request body must be valid JSON.');
  }
}

export function createApp(store: RevisionStore, dist = resolve('dist')) {
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const address = server.address();
    const port = address && typeof address !== 'string' ? address.port : 4173;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.headers.host || '')) {
      json(res, 403, { error: 'Only the loopback host is allowed.' });
      return;
    }
    const ownOrigin = `http://${req.headers.host}`;
    if (
      (req.headers.origin && req.headers.origin !== ownOrigin) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      json(res, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url || '/', ownOrigin).pathname);
    } catch {
      json(res, 400, { error: 'Invalid URL.' });
      return;
    }
    try {
      if (path === '/api/document' && req.method === 'GET') {
        json(res, 200, store.get());
        return;
      }
      if (path === '/api/revisions' && req.method === 'GET') {
        json(res, 200, store.history());
        return;
      }
      const revision = path.match(/^\/api\/revisions\/([1-9]\d*)$/);
      if (revision && req.method === 'GET') {
        const saved = store.get(Number(revision[1]));
        json(res, saved ? 200 : 404, saved || { error: 'Revision not found.' });
        return;
      }
      if (path === '/api/document' && req.method === 'PUT') {
        if (
          req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
        ) {
          json(res, 415, { error: 'Use application/json.' });
          return;
        }
        const body = (await readBody(req)) as {
          document?: unknown;
          expectedRevision?: unknown;
        } | null;
        if (!body || typeof body !== 'object')
          throw new Error('A document and expectedRevision are required.');
        const saved = store.save(
          body.document as Parameters<RevisionStore['save']>[0],
          body.expectedRevision as number,
        );
        json(res, 200, saved);
        return;
      }
      if (path.startsWith('/api/')) {
        json(res, 404, { error: 'API route not found.' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'Method not allowed.' });
        return;
      }
      const file = resolve(dist, path === '/' ? 'index.html' : `.${path}`);
      if (!file.startsWith(dist + sep)) {
        json(res, 403, { error: 'Forbidden path.' });
        return;
      }
      const bytes = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': file.includes(`${sep}assets${sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (error instanceof ConflictError) {
        json(res, 409, { error: error.message, currentRevision: error.currentRevision });
        return;
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        json(res, 404, { error: 'File not found. Run npm run build before npm start.' });
        return;
      }
      const message = error instanceof Error ? error.message : 'Request failed.';
      json(res, 400, { error: message });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
