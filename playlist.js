'use strict';
const { CHANNELS, origin } = require('./_lib');

module.exports = (req, res) => {
  const host = origin(req);
  const q = req.query.proxy === '1' ? '?proxy=1' : '';
  let out = '#EXTM3U\n';
  for (const [slug, name] of Object.entries(CHANNELS)) {
    out += `#EXTINF:-1 tvg-id="${slug}" group-title="Malaysia",${name}\n${host}/${slug}.m3u8${q}\n`;
  }
  res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  res.status(200).send(out);
};
