'use strict';
const { CHANNELS, resolve, sign, origin } = require('./_lib');

// /tv1.m3u8          -> 302 ke m3u8 asli (ringan, tanpa bandwidth Vercel)
// /tv1.m3u8?proxy=1  -> 302 ke /api/p (manifest + segmen lewat Vercel)
module.exports = async (req, res) => {
  const ch = String(req.query.ch || '').toLowerCase();
  if (!CHANNELS[ch]) return res.status(404).send('Channel tidak ada: ' + ch);

  try {
    const hit = await resolve(ch);
    res.setHeader('X-Resolver-Verified', String(hit.verified));
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=30');
    if (req.query.proxy === '1') {
      const t = sign({ u: hit.url, r: hit.referer });
      return res.redirect(302, `${origin(req)}/api/p?t=${t}`);
    }
    return res.redirect(302, hit.url);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).send(`Gagal resolve ${ch}: ${e.message}\nCek: /api/debug?ch=${ch}`);
  }
};
