'use strict';
const { CHANNELS, resolve } = require('./_lib');

// /api/debug?ch=tv1  -> tampilkan langkah-langkah resolve (untuk diagnosa)
module.exports = async (req, res) => {
  const ch = String(req.query.ch || '').toLowerCase();
  if (!CHANNELS[ch]) return res.status(404).json({ error: 'channel tidak ada', available: Object.keys(CHANNELS) });
  const log = [];
  res.setHeader('Cache-Control', 'no-store');
  try {
    const hit = await resolve(ch, { force: true, log });
    res.status(200).json({ ok: true, hit: { url: hit.url, referer: hit.referer, verified: hit.verified }, log });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message, log: e.log || log });
  }
};
