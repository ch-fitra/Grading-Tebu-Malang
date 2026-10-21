# Online melalui pgtrangkil.aisugarcanembs.com

Panduan ini menjadikan komputer Windows sebagai backend aplikasi dan menghubungkannya ke domain melalui Cloudflare Tunnel. Domain meneruskan web, API, media, serta WebSocket ke gateway Nginx lokal pada `http://127.0.0.1:8080`.

## Sebelum memulai

- Instalasi lokal sudah berjalan: dependensi, `.env`, database, migrasi, model, dan CCTV siap sesuai [README utama](../README.md).
- Siapkan akses ke akun Cloudflare yang mengelola `aisugarcanembs.com` dan Tunnel untuk hostname `pgtrangkil`.
- Gunakan password akun yang kuat dan `JWT_SECRET` acak. Pastikan `DATABASE_REQUIRED=true`. API yang dimulai skrip publik berjalan dalam mode production.
- Komputer ini harus terhubung internet dan jaringan/VPN CCTV. Jangan biarkan komputer sleep selama menjadi server.

Jika berpindah dari laptop lama, data yang dipakai adalah database dan snapshot di laptop baru. Git pull hanya memindahkan kode; akun, riwayat, `.env`, model, serta snapshot tidak otomatis dipindahkan. Jika data lama diperlukan, pulihkan backup database dan snapshot sebelum perpindahan server.

## 1. Hentikan mode pengembangan

Selesaikan inspeksi aktif, lalu tekan **Ctrl+C** pada terminal `npm run dev:web`. Jangan menjalankan layanan development dan publik ganda pada port yang sama. PostgreSQL dan VPN tetap aktif.

Jalankan perintah berikut dari akar repository. Contoh untuk CMD pada laptop Pongo:

```cmd
cd /d "C:\Users\Axioo Pongo\Documents\XOORA\AI-Grading-Sugarcane"
```

## 2. Siapkan Nginx dan cloudflared

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-public.ps1
```

Skrip mengunduh Nginx Windows 1.30.6 dari nginx.org dan cloudflared Windows x64 dari rilis resmi Cloudflare jika belum tersedia. Keduanya disimpan di `.runtime/`, di luar Git. Model, token, dan database tidak diunduh oleh skrip ini.

## 3. Build UI untuk domain publik

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-public.ps1
```

Build memakai API dan WebSocket pada origin yang sama dengan halaman publik. Browser pengunjung tidak akan mencoba mengakses localhost miliknya sendiri.

## 4. Jalankan gateway dan backend

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-public.ps1
```

Skrip:

- Menghasilkan konfigurasi Nginx dengan path folder proyek saat ini, termasuk path yang mengandung spasi.
- Memilih `.venv\Scripts\python.exe` jika tersedia, lalu menjalankan API dan AI sebagai proses background dengan log di `.runtime/`.
- Menggunakan layanan API/AI yang sudah aktif jika portnya masih dipakai; hentikan mode development sebelum langkah ini untuk beralih ke proses publik.
- Memeriksa health API/AI dan memulai atau me-reload Nginx milik instalasi yang sama.

Buka **http://127.0.0.1:8080** dan coba login sebelum melanjutkan ke Cloudflare. Health gateway tersedia di **http://127.0.0.1:8080/health**. Jika akses lokal ini gagal, perbaiki lebih dahulu.

Opsional, untuk memeriksa konfigurasi Nginx tanpa memulai atau me-reload layanan:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-public.ps1 -CheckOnly
```

Skrip ini tetap menghasilkan file konfigurasi Nginx lokal, kemudian menjalankan `nginx -t`.

## 5. Periksa route Cloudflare

Di dashboard Cloudflare One, buka **Networking > Tunnels**, lalu pilih Tunnel yang digunakan untuk domain ini. Pada **Routes / Published application**, buat atau periksa route:

| Pengaturan | Nilai |
| --- | --- |
| Subdomain | `pgtrangkil` |
| Domain | `aisugarcanembs.com` |
| Path | Kosong |
| Service type | `HTTP` |
| Service URL | `127.0.0.1:8080` |

Alamat lengkap origin adalah `http://127.0.0.1:8080`. Gunakan route Tunnel/DNS yang sesuai; jangan membuat record A menuju IP lokal laptop. Untuk Tunnel yang sudah ada, gunakan route dan token Tunnel tersebut.

Ambil token connector Windows dari pengaturan pemasangan connector/replica Tunnel. Token berupa teks panjang seperti `eyJ...`. **Jangan kirim token melalui chat atau commit ke Git.**

Sebelum mengaktifkan connector Pongo sebagai pengganti server lama, hentikan connector/service **Tunnel yang sama** di laptop lama. Beberapa connector pada satu Tunnel dapat menerima traffic; database lokal yang terpisah tidak otomatis menjadi satu. Jangan menghapus Tunnel atau record DNS saat hanya memindahkan connector.

## 6. Hubungkan laptop ke Tunnel

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/connect-tunnel.ps1
```

Tempel token pada prompt tersembunyi, lalu tekan Enter. Skrip menyimpan token pada `.runtime/tunnel-token.txt` dengan izin akun Windows saat ini dan SYSTEM. Path file token yang mengandung spasi sudah ditangani.

Periksa status connector **Healthy** pada Cloudflare, kemudian buka:

**https://pgtrangkil.aisugarcanembs.com**

Uji menggunakan ponsel melalui data seluler: halaman login, login, dashboard, video, serta riwayat. Status Healthy membuktikan koneksi Tunnel; aplikasi dan koneksi CCTV tetap perlu diuji.

Route `pgmalang.aisugarcanembs.com` pada konfigurasi Nginx tetap mengembalikan 404 sampai layanan Malang diaktifkan.

## Setelah komputer restart

Nyalakan PostgreSQL dan hubungkan VPN/jaringan CCTV, lalu dari akar proyek:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/resume-public.ps1
```

Skrip memakai token tersimpan tanpa meminta token lagi. Skrip belum memasang autostart/service Windows. Jika komputer dimatikan, sleep, atau internet terputus, domain tidak dapat dilayani oleh komputer ini.

## Pemeriksaan dan kendala

| Kendala | Langkah |
| --- | --- |
| Halaman lokal 8080 gagal | Periksa build UI dan hasil `start-public.ps1`; lihat `.runtime/api-error.log`, `.runtime/ai-error.log`, dan `.runtime/nginx-*/logs/error.log`. |
| Gateway 502 | API belum dapat dijangkau di port 4110 atau gagal startup. Periksa database dan `.env`. |
| Port 8080 dipakai gateway lain | Hentikan gateway lama yang memakai port tersebut sebelum menjalankan versi Nginx baru. Skrip tidak mematikan proses lain secara otomatis. |
| Cloudflare Tunnel Down/Inactive | Periksa koneksi internet, token, dan `.runtime/named-tunnel-error.log`. |
| Cloudflare menampilkan 502 | Pastikan route Tunnel menuju HTTP port 8080 dan gateway lokal dapat dibuka. |
| Halaman terbuka tetapi API menuju localhost pengunjung | Ulangi `build-public.ps1`, lalu muat ulang halaman. |
| Login/riwayat berbeda antar akses | Periksa apakah connector laptop lama masih aktif pada Tunnel yang sama dan apakah database yang dipakai sudah benar. |
| Video offline tetapi halaman online | Periksa VPN, RTSP, model, dan ID kamera pada database laptop ini. |

Pemeriksaan tambahan: `npm run check:ready`. Sesuaikan `REQUIRED_CAMERA_IDS` di `.env` dengan kamera yang benar-benar dipakai. Default adalah 2; instalasi lama dapat memiliki ID berbeda, sehingga nama pabrik saja tidak cukup untuk menentukan ID.

Panduan resmi: [Nginx Windows](https://nginx.org/en/docs/windows.html), [instalasi/route Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/), dan [replica Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/deploy-replicas/).
