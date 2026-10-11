'use strict';
const { CHANNELS, resolve, manifestFor, rewriteManifest, origin } = require('./_lib');

// /tv1.m3u8          -> 302 ke m3u8 asli (ringan, tapi token upstream cepat kedaluwarsa)
// /tv1.m3u8?proxy=1  -> manifest disajikan LANGSUNG di URL ini dan diambil ulang tiap polling
//                       (token selalu segar); segmen lewat /api/p
module.exports = async (req, res) => {
  const ch = String(req.query.ch || '').toLowerCase();
  if (!CHANNELS[ch]) return res.status(404).send('Channel tidak ada: ' + ch);

  try {
    if (req.query.proxy === '1') {
      const m = await manifestFor(ch);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(rewriteManifest(m.text, m.base, m.referer, origin(req)));
    }
    const hit = await resolve(ch);
    res.setHeader('X-Resolver-Verified', String(hit.verified));
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=20');
    return res.redirect(302, hit.url);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).send(`Gagal resolve ${ch}: ${e.message}\nCek: /api/debug?ch=${ch}`);
  }
};
