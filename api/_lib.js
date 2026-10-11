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
function decodeEntities(s) {
  return s.replace(/&(amp|quot|apos|#0*38|#0*34|#0*39|#x2f|#0*47);/gi, (m, g) => {
    g = g.toLowerCase();
    if (g === 'amp' || /^#0*38$/.test(g)) return '&';
    if (g === 'quot' || /^#0*34$/.test(g)) return '"';
    if (g === 'apos' || /^#0*39$/.test(g)) return "'";
    return '/';
  });
}
function unescapeText(s) {
  return decodeEntities(s).replace(/\\u0026/gi, '&').replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
}

function findM3u8(text, base) {
  const t = unescapeText(text);
  const out = new Set();
  for (const m of t.matchAll(/(?:https?:)?\/\/[^\s"'<>\\()]+?\.m3u8(?:\?[^\s"'<>\\()]*)?/gi)) {
    const u = abs(m[0], base);
    if (u) out.add(u);
  }
  for (const m of t.matchAll(/["'(]((?:\.{0,2}\/)[^\s"'<>\\()]+?\.m3u8(?:\?[^\s"'<>\\()]*)?)["')]/gi)) {
    const u = abs(m[1], base);
    if (u) out.add(u);
  }
  for (const m of t.matchAll(/https?%3A%2F%2F[^\s"'<>\\&]+?\.m3u8[^\s"'<>\\&]*/gi)) {
    try { out.add(decodeURIComponent(m[0])); } catch {}
  }
  return [...out];
}

// <video src> / <source src> : kandidat apa pun ekstensinya
function mediaSrc(text, base) {
  const out = new Set();
  for (const m of text.matchAll(/<(?:video|source)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const u = abs(decodeEntities(m[1]), base);
    if (u && /^https?:/i.test(u)) out.add(u);
  }
  return [...out];
}

// URL "mencurigakan" (path mengandung stream/hls/playlist/proxy...) -> dicek isinya (#EXTM3U), bukan ekstensinya
const SOFT_KW = /stream|hls|playlist|manifest|\/live|proxy|\/play|channel/i;
const STATIC_RE =
  /\.(?:js|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|map|json|xml)(?:\?|$)|wp-content\/(?:plugins|themes|uploads)|wp-includes|oembed|xmlrpc|googleapis|gstatic|unpkg|jsdelivr|schema\.org|w\.org|facebook|twitter|google|statcounter|gravatar/i;
function softCandidates(text, base) {
  const t = unescapeText(text);
  const out = new Set();
  const add = (raw) => {
    const u = abs(raw, base);
    if (u && /^https?:/i.test(u) && SOFT_KW.test(u) && !STATIC_RE.test(u)) out.add(u);
  };
  for (const m of t.matchAll(/(?:https?:)?\/\/[^\s"'<>\\()]+/g)) add(m[0]);
  for (const m of t.matchAll(/["'=](\/[A-Za-z0-9_\-.~%/]+(?:\?[^\s"'<>\\()]*)?)["']/g)) add(m[1]);
  return [...out].slice(0, 12);
}

// string base64 panjang (atob("...") dsb) -> teks hasil decode
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
    const u = abs(decodeEntities(m[1]), base);
    if (u && /^https?:/i.test(u) && !FRAME_SKIP.test(u)) out.add(u);
  }
  return [...out];
}

const SCRIPT_SKIP =
  /jquery|googletagmanager|google-analytics|gtag|statcounter|wp-includes|wp-emoji|cloudflare|recaptcha|adsbygoogle|facebook|bootstrap|fontawesome|gstatic|googleapis|unpkg|jsdelivr|video\.min|googlesitekit|\/themes\//i;
const SCRIPT_PREF = /player|stream|proxy|video|init|hls/i;
function scripts(text, base) {
  const out = new Set();
  for (const m of text.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const u = abs(decodeEntities(m[1]), base);
    if (u && /^https?:/i.test(u) && !SCRIPT_SKIP.test(u)) out.add(u);
  }
  return [...out].sort((a, b) => SCRIPT_PREF.test(b) - SCRIPT_PREF.test(a));
}

// ---- petunjuk untuk diagnosa (masuk ke log debug) ----
const squash = (s, n) => s.replace(/\s+/g, ' ').trim().slice(0, n);
function hints(text) {
  const attrs = [];
  for (const m of text.matchAll(/\bdata-([a-z0-9_-]+)\s*=\s*"([^"]{6,500})"/gi)) {
    if (/stream|src|url|source|hls|m3u8|proxy|token|sig|channel|player|config|video|manifest|play/i.test(m[1]))
      attrs.push(`${m[1]}=${squash(decodeEntities(m[2]), 220)}`);
    if (attrs.length >= 10) break;
  }
  const inline = [];
  for (const m of text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/player|stream|proxy|sig|hls|m3u8|token/i.test(m[1]) && !/googletag|gtag|sitekit/i.test(m[1]))
      inline.push(squash(m[1], 500));
    if (inline.length >= 3) break;
  }
  return { attrs, inline };
}

function endpointsFromScript(text) {
  const out = new Set();
  const add = (u) => { if (u && !/\$\{/.test(u)) { const a = abs(u, SITE + '/'); if (a) out.add(a); } };
  for (const m of text.matchAll(/["'`]((?:https?:\/\/[^"'`\s]+)?\/wp-json\/[^"'`\s]+)["'`]/g)) add(m[1]);
  for (const m of text.matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g)) add(m[1]);
  for (const m of text.matchAll(/\.open\(\s*["'][A-Za-z]+["']\s*,\s*["'`]([^"'`]+)["'`]/g)) add(m[1]);
  const actions = [...text.matchAll(/action\s*[:=]\s*["']([\w-]+)["']/g)].map((m) => m[1]);
  return { urls: [...out].filter((u) => !STATIC_RE.test(u) || /wp-json/.test(u)).slice(0, 5), actions: [...new Set(actions)].slice(0, 3) };
}

async function head(r, n = 400) {
  const rd = r.body.getReader();
  let buf = Buffer.alloc(0);
  try {
    while (buf.length < n) {
      const { value, done } = await rd.read();
      if (done) break;
      buf = Buffer.concat([buf, Buffer.from(value)]);
    }
  } finally {
    try { await rd.cancel(); } catch {}
  }
  return buf.toString('utf8', 0, n);
}

async function discover(slug, log) {
  const found = [];
  const soft = new Set();
  const seen = new Set();
  const pageUrl = `${SITE}/${slug}/`;

  const take = (text, base, from, referer) => {
    const all = text + blobs(text);
    findM3u8(all, base).forEach((u) => found.push({ url: u, from, referer }));
    mediaSrc(all, base).forEach((u) => soft.add(u));
    softCandidates(all, base).forEach((u) => soft.add(u));
  };

  // kandidat "mencurigakan" (tanpa ekstensi .m3u8) -> cek isinya (#EXTM3U)
  const sniffSoft = async () => {
    if (found.length || !soft.size) return;
    const list = [...soft].slice(0, 12);
    soft.clear();
    await Promise.all(
      list.map(async (u) => {
        try {
          const r = await get(u, pageUrl, 6000);
          const h = r.ok ? await head(r, 300) : '';
          const ok = h.includes('#EXTM3U');
          log.push({ step: 'soft', url: u, status: r.status, ok });
          if (ok) found.push({ url: u, from: pageUrl, referer: pageUrl });
        } catch (e) {
          log.push({ step: 'soft', url: u, error: String(e.message || e) });
        }
      })
    );
  };

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
    log.push({ step: 'fetch', url, status: r.status, bytes: text.length, frames: fr, scripts: sc, hints: hints(text) });
    if (!r.ok) return;

    take(text, base, url, ref);
    if (found.length) return;
    await sniffSoft();
    if (found.length) return;

    for (const f of fr) {
      findM3u8(f, f).forEach((u) => found.push({ url: u, from: f, referer: url }));
      if (found.length) return;
      await visit(f, url, depth + 1);
      if (found.length) return;
    }

    for (const s of sc.slice(0, 5)) {
      try {
        const sr = await get(s, url);
        const st = await sr.text();
        const ep = endpointsFromScript(st);
        log.push({ step: 'script', url: s, status: sr.status, bytes: st.length, head: squash(st, 1200), endpoints: ep.urls, actions: ep.actions });
        take(st, s, s, url);
        if (found.length) return;
        // endpoint yang tertulis langsung di script (REST / ajax)
        const eps = [...ep.urls];
        for (const a of ep.actions)
          eps.push(`${SITE}/wp-admin/admin-ajax.php?action=${a}&channel=${slug}&slug=${slug}&id=${slug}`);
        for (const e of eps.slice(0, 6)) {
          try {
            const er = await get(e, url, 6000);
            const et = (await head(er, 4000)) || '';
            log.push({ step: 'endpoint', url: e, status: er.status, type: er.headers.get('content-type'), head: squash(et, 300) });
            if (er.ok) take(et, e, url, url);
            if (found.length) return;
          } catch (err) {
            log.push({ step: 'endpoint', url: e, error: String(err.message || err) });
          }
        }
      } catch (e) {
        log.push({ step: 'script', url: s, error: String(e.message || e) });
      }
    }
  };

  await visit(pageUrl, SITE + '/', 0);

  await sniffSoft();

  const uniq = new Map();
  found.forEach((f) => { if (!uniq.has(f.url)) uniq.set(f.url, f); });
  return [...uniq.values()];
}

async function probe(url, refs, log) {
  for (const ref of refs) {
    try {
      const r = await get(url, ref, 7000);
      const body = r.ok ? await head(r, 300) : '';
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
    const refs = [...new Set([SITE + '/', cand.from, cand.referer, null])];
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

// Ambil manifest channel; kalau upstream menolak (token kedaluwarsa) resolve ulang sekali.
async function manifestFor(slug) {
  let lastErr = 'tidak diketahui';
  for (let i = 0; i < 2; i++) {
    const hit = await resolve(slug, { force: i === 1 });
    try {
      const r = await get(hit.url, hit.referer, 10000);
      if (r.ok) {
        const text = await r.text();
        if (text.includes('#EXTM3U')) return { text, base: r.url || hit.url, referer: hit.referer };
        lastErr = 'isi bukan playlist HLS';
      } else {
        lastErr = 'upstream ' + r.status;
      }
    } catch (e) {
      lastErr = String(e.message || e);
    }
  }
  throw new Error('manifest gagal diambil: ' + lastErr);
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
  SITE, CHANNELS, get, abs, findM3u8, blobs, frames, resolve, manifestFor, sign, verify, origin, rewriteManifest,
};
