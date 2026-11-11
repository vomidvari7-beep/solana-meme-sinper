export const WSOL = 'So11111111111111111111111111111111111111112';
export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function tehranDayKey(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}

export function emaLast(values, n) {
  if (!values || values.length < n) return null;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += values[i];
  e /= n;
  for (let i = n; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function swingPoints(cs, k = 2) {
  const highs = [], lows = [];
  for (let i = k; i < cs.length - k; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k; j++) {
      if (!(cs[i].h > cs[i - j].h && cs[i].h >= cs[i + j].h)) isH = false;
      if (!(cs[i].l < cs[i - j].l && cs[i].l <= cs[i + j].l)) isL = false;
    }
    if (isH) highs.push({ i, price: cs[i].h });
    if (isL) lows.push({ i, price: cs[i].l });
  }
  return { highs, lows };
}

export function lineAt(a, b, i) {
  if (b.i === a.i) return b.price;
  return a.price + (b.price - a.price) * (i - a.i) / (b.i - a.i);
}

export function usd6(n) { return Math.round((+n || 0) * 1e6) / 1e6; }

const SECRETISH = /[1-9A-HJ-NP-Za-km-z]{40,}/g;
export function redact(msg) {
  return String(msg || '').replace(SECRETISH, (m) => (m.length >= 60 ? '[redacted]' : m)).slice(0, 400);
}

export function log(kind, msg) {
  const line = new Date().toISOString() + ' ' + kind + ' ' + redact(msg);
  console.log(line);
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
