# Gateway dan publikasi Malang

Ikuti [README utama](../README.md). Jalankan `npm run start:malang` untuk API 4111, AI 8011, dan gateway 8081. Nginx dibuat dari `deploy/nginx.conf` ke `.runtime/malang/conf/nginx.conf`, dengan root absolut UI Malang. PID/log/prefix terpisah dari Trangkil.

Domain: **https://pgmalang.aisugarcanembs.com**. Konfigurasi Nginx dan `PUBLIC_ORIGINS` sudah memuat domain ini.

Pada Cloudflare Tunnel, tambahkan published application route:

| Field | Nilai |
|---|---|
| Subdomain | pgmalang |
| Domain | aisugarcanembs.com |
| Path | Kosong |
| Service type | HTTP |
| Service URL | 127.0.0.1:8081 |

Tunnel connector harus berjalan pada server yang sama dengan gateway Malang. Jika memakai tunnel bersama Trangkil, pertahankan route Trangkil dan tambahkan route Malang secara terpisah. Tidak perlu mengekspos port 4111/8011 ke internet. Jangan memakai token tunnel warisan tanpa memastikan kepemilikan tunnel. Web memakai API/media/WebSocket pada origin yang sama.

Verifikasi setelah route diaktifkan: `https://pgmalang.aisugarcanembs.com/health` harus mengembalikan `installation: malang`, lalu periksa login, stream dan WebSocket.

Tidak ada perubahan DNS, tunnel, service Windows, atau produksi Trangkil dalam penyiapan lokal ini.
