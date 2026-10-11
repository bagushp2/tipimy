'use strict';
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { get, verify, origin, rewriteManifest } = require('./_lib');

// Proxy: manifest ditulis ulang, segmen/key di-stream. Hanya melayani URL bertanda tangan (SIGN_KEY).
module.exports = async (req, res) => {
  let tok;
  try { tok = verify(String(req.query.t || '')); }
  catch (e) { return res.status(500).send(e.message); }
  if (!tok || !tok.u) return res.status(403).send('token tidak valid');

  let r;
  try { r = await get(tok.u, tok.r, 15000); }
  catch (e) { return res.status(504).send('upstream timeout/error: ' + e.message); }
  if (!r.ok) return res.status(r.status).send('upstream ' + r.status);

  const ct = r.headers.get('content-type') || '';
  const isManifest = /mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(tok.u);

  if (isManifest) {
    const text = await r.text();
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(rewriteManifest(text, r.url || tok.u, tok.r, origin(req)));
  }

  res.status(200);
  res.setHeader('Content-Type', ct || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  try { await pipeline(Readable.fromWeb(r.body), res); } catch { /* klien putus */ }
};
