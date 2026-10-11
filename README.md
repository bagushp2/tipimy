# TV Resolver (Vercel)

Link permanen `.m3u8` untuk VLC

## Deploy
1. Taruh folder ini di repo GitHub, import ke Vercel (atau `vercel --prod` dari folder ini).
2. (Opsional, untuk mode proxy) Settings > Environment Variables: `SIGN_KEY` = string acak panjang.
3. Buka `https://<project>.vercel.app/api/debug?ch=tv1` untuk cek hasil resolve.

## Pakai di VLC
- Satu channel : `https://<project>.vercel.app/tv1.m3u8`
- Semua channel: `https://<project>.vercel.app/playlist.m3u`
- Mode proxy   : tambahkan `?proxy=1` (butuh SIGN_KEY)

Slug: tv1, tv2, tv3, didiktv, 8tv, tv9, alhijrah, okey, sukan-rtm, berita-rtm, bernama
