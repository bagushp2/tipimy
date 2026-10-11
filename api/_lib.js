'use strict';
const crypto = require('crypto');

const SITE = (process.env.SITE_URL || 'https://tvmalaysia.com.co').replace(/\/+$/, '');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// slug di tvmalaysia.com.co  ->  nama channel
const CHANNELS = {
  tv1: 'TV1',
  tv2: 'TV2',
  tv3: 'TV3',
  didiktv: 'Didik TV',
  '8tv': '8TV',
  tv9: 'TV9',
  alhijrah: 'TV Alhijrah',
  okey: 'Okey TV',
  'sukan-rtm': 'Sukan RTM',
  'berita-rtm': 'Berita RTM',
  bernama: 'Bernama TV',
};

/* ---------- HTTP ---------- */
async function get(url, referer, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const headers = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'ms-MY,ms;q=0.9,en;q=0.8' };
  if (referer) {
    headers.Referer = referer;
    try { headers.Origin = new URL(referer).origin; } catch {}
  }
  try {
    return await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function abs(u, base) {
  try { return new URL(u, base).href; } catch { return null; }
}

/* ---------- Ekstraksi ---------- */
function unescapeText(s) {
  return s.replace(/\\u0026/gi, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
}

function findM3u8(text, base) {
  const t = unescapeText(text);
  const out = new Set();
  // absolut / protocol-relative
  for (const m of t.matchAll(/(?:https?:)?\/\/[^\s"'<>\\()]+?\.m3u8(?:\?[^\s"'<>\\()]*)?/gi)) {
    const u = abs(m[0], base);
    if (u) out.add(u);
  }
  // relatif: "/live/x.m3u8"
  for (const m of t.matchAll(/["'(]((?:\.{0,2}\/)[^\s"'<>\\()]+?\.m3u8(?:\?[^\s"'<>\\()]*)?)["')]/gi)) {
    const u = abs(m[1], base);
    if (u) out.add(u);
  }
  // percent-encoded (biasanya di query iframe: ?url=https%3A%2F%2F...m3u8)
  for (const m of t.matchAll(/https?%3A%2F%2F[^\s"'<>\\&]+?\.m3u8[^\s"'<>\\&]*/gi)) {
    try { out.add(decodeURIComponent(m[0])); } catch {}
  }
  return [...out];
}

// string base64 panjang (atob("...") dsb) -> teks hasil decode, untuk di-scan juga
function blobs(text) {
  let extra = '';
  let n = 0;
  for (const m of text.matchAll(/["']([A-Za-z0-9+/_-]{40,}={0,2})["']/g)) {
    if (++n > 200) break;
    try {
      const d = Buffer.from(m[1], 'base64').toString('utf8');
      if (/m3u8|https?:\/\//i.test(d) && !/[\x00-\x08]/.test(d)) extra += '\n' + d;
    } catch {}
  }
  return extra;
}

const FRAME_SKIP = /googletagmanager|doubleclick|facebook\.com|statcounter|googlesyndication/i;
function frames(text, base) {
  const out = new Set();
  for (const m of text.matchAll(/<iframe\b[^>]*?\b(?:data-lazy-src|data-src|src)\s*=\s*["']([^"']+)["']/gi)) {
    const u = abs(m[1].replace(/&amp;/g, '&'), base);
    if (u && /^https?:/i.test(u) && !FRAME_SKIP.test(u)) out.add(u);
  }
  return [...out];
}

const SCRIPT_SKIP =
  /jquery|googletagmanager|google-analytics|gtag|statcounter|wp-includes|wp-emoji|cloudflare|recaptcha|adsbygoogle|facebook|bootstrap|fontawesome|gstatic|googleapis/i;
function scripts(text, base) {
  const out = new Set();
  for (const m of text.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const u = abs(m[1].replace(/&amp;/g, '&'), base);
    if (u && /^https?:/i.test(u) && !SCRIPT_SKIP.test(u)) out.add(u);
  }
  return [...out];
}

async function discover(slug, log) {
  const found = [];
  const seen = new Set();

  const visit = async (url, ref, depth) => {
    if (seen.has(url) || seen.size >= 14 || depth > 3) return;
    seen.add(url);
    let r, text;
    try {
      r = await get(url, ref);
      text = await r.text();
    } catch (e) {
      log.push({ step: 'fetch', url, error: String(e.message || e) });
      return;
    }
    const base = r.url || url;
    const all = text + blobs(text);
    const fr = frames(all, base);
    const sc = scripts(all, base);
    log.push({ step: 'fetch', url, status: r.status, bytes: text.length, frames: fr, scripts: sc.slice(0, 8) });
    if (!r.ok) return;

    const direct = findM3u8(all, base);
    direct.forEach((u) => found.push({ url: u, from: url, referer: ref }));
    if (found.length) return;

    for (const f of fr) {
      findM3u8(f, f).forEach((u) => found.push({ url: u, from: f, referer: url }));
      if (found.length) return;
      await visit(f, url, depth + 1);
      if (found.length) return;
    }

    for (const s of sc.slice(0, 4)) {
      try {
        const sr = await get(s, url);
        const st = await sr.text();
        findM3u8(st + blobs(st), s).forEach((u) => found.push({ url: u, from: s, referer: url }));
        if (found.length) return;
      } catch {}
    }
  };

  await visit(`${SITE}/${slug}/`, SITE + '/', 0);
  const uniq = new Map();
  found.forEach((f) => { if (!uniq.has(f.url)) uniq.set(f.url, f); });
  return [...uniq.values()];
}

async function probe(url, refs, log) {
  for (const ref of refs) {
    try {
      const r = await get(url, ref, 7000);
      const body = r.ok ? (await r.text()).slice(0, 300) : '';
      const ok = r.ok && body.includes('#EXTM3U');
      log.push({ step: 'probe', url, referer: ref, status: r.status, ok });
      if (ok) return { ok: true, ref };
    } catch (e) {
      log.push({ step: 'probe', url, referer: ref, error: String(e.message || e) });
    }
  }
  return { ok: false };
}

/* ---------- Resolve + cache (per instance, singkat) ---------- */
const cache = new Map();
const TTL = 60 * 1000;

async function resolve(slug, { force = false, log = [] } = {}) {
  const c = cache.get(slug);
  if (!force && c && c.exp > Date.now()) return c;

  const cands = await discover(slug, log);
  if (!cands.length) {
    const err = new Error('URL m3u8 tidak ditemukan di halaman / iframe / script');
    err.log = log;
    throw err;
  }
  for (const cand of cands) {
    const refs = [...new Set([cand.from, cand.referer, SITE + '/', null])];
    const p = await probe(cand.url, refs, log);
    if (p.ok) {
      const v = { url: cand.url, referer: p.ref, verified: true, exp: Date.now() + TTL };
      cache.set(slug, v);
      return v;
    }
  }
  // Tidak ada yang lolos probe dari server Vercel (mis. token terikat IP / geo-block).
  // Tetap kembalikan kandidat pertama; mungkin tetap jalan dari IP pemirsa.
  const c0 = cands[0];
  const v = { url: c0.url, referer: c0.from, verified: false, exp: Date.now() + 15000 };
  cache.set(slug, v);
  return v;
}

/* ---------- Token bertanda tangan untuk /api/p ---------- */
function key() {
  const k = process.env.SIGN_KEY;
  if (!k) throw new Error('Env SIGN_KEY belum diset (dibutuhkan untuk mode proxy)');
  return k;
}
function sign(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const s = crypto.createHmac('sha256', key()).update(p).digest('base64url');
  return `${p}.${s}`;
}
function verify(tok) {
  if (typeof tok !== 'string' || !tok.includes('.')) return null;
  const [p, s] = tok.split('.');
  const good = crypto.createHmac('sha256', key()).update(p).digest('base64url');
  const a = Buffer.from(s), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
}

function origin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function rewriteManifest(text, base, ref, host) {
  const wrap = (u) => {
    const a = abs(u, base);
    return a ? `${host}/api/p?t=${sign({ u: a, r: ref })}` : u;
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const l = line.trim();
      if (!l) return line;
      if (l.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`);
      return wrap(l);
    })
    .join('\n');
}

module.exports = {
  SITE, CHANNELS, get, abs, findM3u8, blobs, frames, resolve, sign, verify, origin, rewriteManifest,
};
