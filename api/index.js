'use strict';
const { CHANNELS, origin } = require('./_lib');

module.exports = (req, res) => {
  const host = origin(req);
  const rows = Object.entries(CHANNELS)
    .map(([s, n]) => `<tr><td>${n}</td><td><code>${host}/${s}.m3u8</code></td><td><a href="/api/debug?ch=${s}">debug</a></td></tr>`)
    .join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TV Malaysia Resolver</title>
<style>body{font:15px system-ui;max-width:760px;margin:2rem auto;padding:0 1rem}td{padding:.35rem .6rem;border-bottom:1px solid #ccc}code{word-break:break-all}</style>
<h2>TV Malaysia Resolver</h2>
<p>Playlist semua channel: <code>${host}/playlist.m3u</code> (tambah <code>?proxy=1</code> untuk mode proxy)</p>
<table>${rows}</table>`);
};
