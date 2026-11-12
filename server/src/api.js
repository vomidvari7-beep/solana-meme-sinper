import { createServer } from 'node:http';
import { tokensMatch } from './keystore.js';
import { log } from './util.js';

const MODES = ['scalp', 'breakout', 'plans', 'degen', 'scan'];
const PANEL_ORIGIN = 'https://vomidvari7-beep.github.io';

function corsHeaders(req) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' };
  if (req.headers.origin === PANEL_ORIGIN) {
    headers['access-control-allow-origin'] = PANEL_ORIGIN;
    headers['access-control-allow-headers'] = 'authorization, content-type, x-sms-token';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
  }
  return headers;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 20000) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

export function startApi(cfg, state, engine) {
  const server = createServer(async (req, res) => {
    const send = (code, body) => {
      const json = body == null ? '' : JSON.stringify(body);
      res.writeHead(code, corsHeaders(req));
      res.end(json);
    };
    if (req.method === 'OPTIONS') { send(204, {}); return; }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/health') { send(200, { ok: true }); return; }
    const header = String(req.headers.authorization || '');
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-sms-token'] || '');
    if (!cfg.apiToken || !tokensMatch(presented, cfg.apiToken)) { send(401, { ok: false, error: 'token' }); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/api/status') { send(200, engine.status()); return; }
      if (req.method === 'POST' && url.pathname === '/api/pause') {
        state.data.paused = true;
        state.save();
        log('api', 'pause all buys and exits');
        send(200, engine.status());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/resume') {
        state.data.paused = false;
        state.save();
        log('api', 'resume');
        send(200, engine.status());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/vault') {
        const body = await readBody(req);
        const n = +body.sol;
        if (!Number.isFinite(n) || n < 0 || n > 1e6) { send(400, { ok: false, error: 'vault sol' }); return; }
        state.data.vaultSol = Math.round(n * 1e9) / 1e9;
        state.save();
        log('api', 'vault ' + state.data.vaultSol + ' SOL');
        send(200, engine.status());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/mode') {
        const body = await readBody(req);
        for (const key of MODES) if (typeof body[key] === 'boolean') state.data.toggles[key] = body[key];
        state.data.toggles.scalp = false;
        if (typeof body.degenTradeUsd === 'number' && body.degenTradeUsd >= 0.5 && body.degenTradeUsd <= 1000) state.data.degenTradeUsd = body.degenTradeUsd;
        state.save();
        log('api', 'toggles ' + JSON.stringify(state.data.toggles));
        send(200, engine.status());
        return;
      }
      send(404, { ok: false, error: 'not found' });
    } catch (e) {
      send(400, { ok: false, error: String(e.message || e).slice(0, 120) });
    }
  });
  server.listen(cfg.port, cfg.bind, () => log('api', 'status on ' + cfg.bind + ':' + cfg.port));
  return server;
}
