import { log } from './util.js';

const OHLCV = {
  '1m': { path: 'minute', aggregate: 1, limit: 80 },
  '15m': { path: 'minute', aggregate: 15, limit: 80 },
  '1h': { path: 'hour', aggregate: 1, limit: 80 },
  '4h': { path: 'hour', aggregate: 4, limit: 80 },
  '1d': { path: 'day', aggregate: 1, limit: 80 }
};

export function createNet(cfg) {
  const cache = new Map();
  async function getJSON(url, ms = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'cache-control': 'no-store' } });
      if (!res.ok) throw new Error(res.status + ' ' + url.slice(0, 80));
      return await res.json();
    } finally { clearTimeout(t); }
  }
  async function agents() {
    const names = ['degen', 'plans', 'candidates', 'mylist', 'mylist_scores', 'risk', 'blacklist'];
    const shaRes = await getJSON('https://api.github.com/repos/' + cfg.repo + '/commits?sha=main&per_page=1&t=' + Date.now(), 8000);
    const sha = shaRes && shaRes[0] && shaRes[0].sha;
    if (!sha) throw new Error('no commit sha');
    const out = {};
    await Promise.all(names.map(async (name) => {
      const url = 'https://raw.githubusercontent.com/' + cfg.repo + '/' + sha + '/agents/' + name + '.json?t=' + Date.now();
      try { out[name] = await getJSON(url, 8000); }
      catch (e) { log('agents', name + ' ' + (e.message || e)); }
    }));
    out.sha = sha;
    return out;
  }
  async function dex(mints) {
    const best = new Map();
    const ids = [...new Set(mints.filter(Boolean))].slice(0, 60);
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      if (!chunk.length) continue;
      try {
        const arr = await getJSON('https://api.dexscreener.com/tokens/v1/solana/' + chunk.join(','), 8000);
        for (const p of arr || []) {
          const mint = p?.baseToken?.address;
          if (!mint) continue;
          const cur = best.get(mint);
          if (!cur || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0)) best.set(mint, p);
        }
      } catch (e) { log('price', e.message || e); }
    }
    return best;
  }
  async function ohlcv(pool, tf, mint) {
    const spec = OHLCV[tf];
    if (!pool || !spec) return [];
    const key = pool + '|' + tf + (mint ? '|' + mint : '');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 20000) return hit.candles;
    const tokenQ = mint ? '&token=' + encodeURIComponent(mint) : '';
    const url = 'https://api.geckoterminal.com/api/v2/networks/solana/pools/' + pool + '/ohlcv/' + spec.path + '?aggregate=' + spec.aggregate + '&limit=' + spec.limit + '&currency=usd' + tokenQ;
    const j = await getJSON(url, 12000);
    const list = j?.data?.attributes?.ohlcv_list || [];
    const candles = list.map(r => ({ t: +r[0] * (r[0] < 1e12 ? 1000 : 1), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })).filter(c => c.c > 0 && c.l > 0).sort((a, b) => a.t - b.t).slice(-300);
    cache.set(key, { at: Date.now(), candles });
    if (cache.size > 40) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
      while (cache.size > 32) cache.delete(oldest.shift()[0]);
    }
    return candles;
  }
  async function sol() {
    try {
      const arr = await getJSON('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112', 8000);
      const usdc = (arr?.pairs || []).find(p => p.quoteToken?.symbol === 'USDC' || p.baseToken?.symbol === 'USDC');
      const px = usdc ? +usdc.priceUsd : null;
      const h1 = usdc?.priceChange?.h1 != null ? +usdc.priceChange.h1 : null;
      const m5 = usdc?.priceChange?.m5 != null ? +usdc.priceChange.m5 : null;
      return { price: px, h1, m5, pool: usdc?.pairAddress || '' };
    } catch { return { price: null, h1: null, m5: null }; }
  }
  async function newPools() {
    const urls = [
      'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
      'https://api.geckoterminal.com/api/v2/networks/solana/dexes/pumpswap/new_pools?page=1'
    ];
    const url = urls[Math.floor(Date.now() / 8000) % urls.length];
    const j = await getJSON(url, 8000);
    return (j?.data || []).map(row => {
      const a = row.attributes || {};
      const idOf = (rel) => String(rel?.data?.id || '').replace(/^solana_/, '');
      let mint = idOf(row.relationships?.base_token);
      const quote = idOf(row.relationships?.quote_token);
      const SOL = 'So11111111111111111111111111111111111111112';
      if (mint === SOL) mint = quote;
      if (!mint || mint.length < 32) return null;
      return {
        mint, symbol: String(a.name || mint).split('/')[0].trim(), pool: a.address || '',
        created: Date.parse(a.pool_created_at || '') || null,
        liq: +a.reserve_in_usd || null, price: +a.base_token_price_usd || null,
        m5b: +a.transactions?.m5?.buys || 0, m5s: +a.transactions?.m5?.sells || 0,
        m5vol: +a.volume_usd?.m5 || 0
      };
    }).filter(Boolean);
  }
  return { getJSON, agents, dex, ohlcv, sol, newPools };
}

export function tapeFromDex(p) {
  if (!p) return {};
  return {
    px: +p.priceUsd || 0,
    liq: p.liquidity?.usd ?? null,
    mcap: p.marketCap ?? p.fdv ?? null,
    vol24: p.volume?.h24 ?? null,
    m5: p.priceChange?.m5 != null ? +p.priceChange.m5 : null,
    h1: p.priceChange?.h1 != null ? +p.priceChange.h1 : null,
    m5b: +p.txns?.m5?.buys || 0,
    m5s: +p.txns?.m5?.sells || 0,
    h1b: +p.txns?.h1?.buys || 0,
    h1s: +p.txns?.h1?.sells || 0,
    m5vol: +p.volume?.m5 || 0,
    h1vol: +p.volume?.h1 || 0,
    dex: p.dexId || '',
    pool: p.pairAddress || '',
    symbol: p.baseToken?.symbol || '',
    ageH: p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3.6e6 : null
  };
}
