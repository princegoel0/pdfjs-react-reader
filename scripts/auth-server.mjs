// A dev-only document server for the `0.9` gate: it answers `GET /*.pdf` from
// `playground/fixtures/` only when the request carries `Authorization: Bearer
// <token>`, so the playground can be pointed at a document that genuinely needs
// the `httpHeaders` FR-34 forwards. Run it beside `npm run dev` and load
// `http://localhost:5300/outline-sample.pdf` there with the token in the box.
//
// Not a product, not shipped, and deliberately narrow: one directory, flat file
// names, one header, one token. CORS is open because the only client is a
// localhost dev server, and a file that answers 401 to the wrong token is the
// whole point — a request that never carries the header cannot be the one that
// proves the header works.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'playground', 'fixtures');
const PORT = Number(process.env.AUTH_PORT ?? 5300);
const TOKEN = process.env.AUTH_TOKEN ?? 'dev-token';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
};

createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
  const authorized = req.headers.authorization === `Bearer ${TOKEN}`;
  console.log(`${req.method} /${name} — ${authorized ? 'authorized' : 'no valid bearer token'}`);

  if (!authorized) {
    // A 401 with no body. pdf.js reports the status, and the viewer shows the
    // failure the host's `httpHeaders` were meant to prevent.
    res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Bearer' });
    res.end('unauthorized\n');
    return;
  }

  if (!/^[\w.-]+\.pdf$/.test(name)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('expected a flat fixture name, e.g. /outline-sample.pdf\n');
    return;
  }
  const file = join(FIXTURES, name);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('no such fixture\n');
    return;
  }

  const size = statSync(file).size;
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': String(size),
    'Accept-Ranges': 'bytes',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`serving ${FIXTURES} behind Bearer "${TOKEN}" on http://localhost:${PORT}`);
});
