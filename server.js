// ============ Server HTTP — zero dipendenze (solo core Node) ============
// Serve la SPA statica in /public ed espone l'API dati in /api.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportData, importData, applyChanges, resetData, seedIfEmpty, counts } from './server/serialize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT || 4332;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(null); } });
});

// Seam autenticazione — PREDISPOSIZIONE multiutenza. Ora no-op: un unico utente locale.
function currentUser(_req) { return { id: 'local', name: 'Locale', ruolo: 'admin', permessi: [] }; }

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', <resource>]
  const resource = parts[1];
  const method = req.method;
  const user = currentUser(req);
  void user;

  if (resource === 'health' && method === 'GET') {
    return json(res, 200, { ok: true, app: 'zen-human-server', ...counts() });
  }

  // Stato completo: GET per il boot, PUT per sostituzione totale (import/wipe).
  if (resource === 'data') {
    if (method === 'GET') return json(res, 200, exportData());
    if (method === 'PUT') {
      const b = await readBody(req);
      if (b == null) return json(res, 400, { error: 'JSON non valido' });
      const force = url.searchParams.get('force') === '1';
      try { return json(res, 200, { ok: true, ...importData(b, { force }) }); }
      catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    }
  }

  // Scritture GRANULARI: applica solo i record cambiati.
  if (resource === 'changes' && method === 'POST') {
    const b = await readBody(req);
    if (b == null) return json(res, 400, { error: 'JSON non valido' });
    try { return json(res, 200, { ok: true, ...applyChanges(b) }); }
    catch (e) { return json(res, 400, { error: String(e.message || e) }); }
  }

  if (resource === 'reset' && method === 'POST') {
    return json(res, 200, { ok: true, ...resetData() });
  }

  return json(res, 404, { error: 'endpoint non trovato' });
}

function statusPage() {
  const c = counts();
  const rows = Object.entries(c).filter(([k]) => k !== 'rev')
    .map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right">${v}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Zen-Human server</title>
  <style>body{font:15px/1.5 system-ui;margin:3rem auto;max-width:34rem;color:#26303a}
  h1{font-size:1.2rem}code{background:#eef;padding:.1em .35em;border-radius:4px}
  table{border-collapse:collapse;margin-top:1rem}td{border-bottom:1px solid #e5e7eb;padding:.3rem .8rem}</style>
  <h1>🟢 Zen-Human — server dati attivo</h1>
  <p>DB relazionale (node:sqlite) — <b>rev ${c.rev}</b>. Frontend non ancora portato.</p>
  <p>API: <code>GET /api/data</code> · <code>PUT /api/data</code> · <code>POST /api/changes</code> · <code>POST /api/reset</code> · <code>GET /api/health</code></p>
  <table><tr><th style="text-align:left">Tabella</th><th>Righe</th></tr>${rows}</table>`;
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') {
    try { const html = await readFile(join(PUBLIC, 'index.html')); res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(html); }
    catch { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(statusPage()); }
  }
  const filePath = normalize(join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

seedIfEmpty();

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'Errore interno', detail: String(err.message || err) });
  }
}).listen(PORT, () => {
  console.log(`\n  Zen-Human — server dati`);
  console.log(`  ▸ http://localhost:${PORT}`);
  console.log(`  ▸ rev ${counts().rev}\n`);
});
