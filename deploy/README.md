# Server sementara Windows

Jalankan dari akar proyek:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-public.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-public.ps1
```

Gateway Nginx: `http://127.0.0.1:8080`. Frontend memakai API dan WebSocket pada origin yang sama; video melalui API dengan pemeriksaan login dan akses pabrik. Service AI dan database tetap internal.

Untuk Tunnel yang sudah dibuat di Cloudflare:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/connect-tunnel.ps1
```

Tempel hanya token Tunnel pada prompt tersembunyi. Token disimpan dalam `.runtime/tunnel-token.txt`, di luar Git dan dibatasi ke akun Windows saat ini serta SYSTEM.

Domain publik yang diaktifkan untuk tahap ini:

| Hostname | Service URL |
| --- | --- |
| pgtrangkil.aisugarcanembs.com | http://127.0.0.1:8080 |

Trangkil menggunakan aplikasi dengan akses data dibatasi akun dan izin backend. Route Malang masih tercatat di Cloudflare tetapi dibatasi Nginx dengan HTTP 404 sampai tahap Malang diaktifkan. DNS route dibuat melalui dashboard Tunnel. Jangan arahkan record A ke IP laptop.

Untuk menyalakan kembali server dan Tunnel setelah restart, tanpa memasukkan ulang token:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/resume-public.ps1
```

Hubungkan kembali FortiClient profil PGTK. Server web dapat online saat VPN terputus, tetapi video Trangkil membutuhkan VPN yang aktif.

URL Quick Tunnel sementara terdapat di `.runtime/public-url.txt`; proses Quick Tunnel sudah berjalan untuk demo. URL itu berubah jika Quick Tunnel dibuat ulang. Tunnel bernama tidak bergantung pada URL sementara.

Laptop harus tetap hidup dan tersambung internet. Skrip ini belum memasang autostart Windows; sesudah restart jalankan kembali start-public dan connector. Build publik mengubah hasil build renderer desktop ke origin web; build desktop untuk penggunaan lokal melalui `npm run build` secara terpisah.
