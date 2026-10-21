# Tebu AI

Aplikasi inspeksi mutu tebu melalui CCTV dan AI. Web memakai React, API memakai Fastify, dan service AI memakai Python dengan PostgreSQL. Electron menggunakan UI web yang sama; klien Flutter tersedia untuk Android/iOS.

## Persyaratan

- Windows dengan PowerShell, Node.js 22.12+ dan npm.
- Python 3.10+ yang kompatibel dengan `apps/ai-service/requirements.txt`.
- PostgreSQL 16 atau Docker Desktop untuk database lokal.
- Model AI dan koneksi CCTV/RTSP untuk melakukan inspeksi.

## Instalasi

Jalankan dari akar repository:

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r apps/ai-service/requirements.txt
```

Edit `.env`: isi `DATABASE_URL` untuk database aplikasi (`sugarcane`), `AI_DATABASE_URL` untuk database AI (`sugarcane_ai`), `JWT_SECRET`, akun/password bootstrap, serta konfigurasi CCTV. Ganti semua placeholder password/secret sebelum startup. File `.env` tidak masuk Git.

Untuk database lokal melalui Docker:

```powershell
npm run db:up
# Tunggu database berstatus healthy.
docker compose ps
npm run db:migrate
```

Jika PostgreSQL sudah tersedia, lewati `db:up` dan sesuaikan kedua connection string. Service AI membuat database `sugarcane_ai` dan tabelnya saat startup; user PostgreSQL perlu izin membuat database, atau database tersebut harus dibuat terlebih dahulu.

Login menggunakan akun yang dikonfigurasi di `.env`. Akun bootstrap hanya dibuat bila belum ada; mengganti password di `.env` tidak mengubah password akun yang sudah tersimpan.

## Menjalankan web

Dengan `.venv` aktif dan database siap:

```powershell
npm run dev:web
```

Buka **http://127.0.0.1:5175**. Perintah ini menjalankan web, API, dan AI sekaligus. Tekan **Ctrl+C** untuk menghentikannya.

| Layanan | Alamat lokal |
| --- | --- |
| Web | http://127.0.0.1:5175 |
| API | http://127.0.0.1:4110/health |
| AI | http://127.0.0.1:8010/health |
| Dokumentasi endpoint AI | http://127.0.0.1:8010/docs |

Untuk layanan terpisah, gunakan `npm run dev:api`, `npm run dev:ai`, dan `npm run dev:frontend` pada terminal masing-masing. Jika aktivasi virtual environment diblokir PowerShell, jalankan AI dengan `.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir apps/ai-service --host 127.0.0.1 --port 8010 --reload`.

## Kamera dan model

Siapkan kamera/RTSP dan ROI sesuai instalasi. Model tidak disertakan di Git. Konfigurasi aktif berada di `apps/ai-service/models/active/config.json`; letakkan file model sesuai `model_path`. Konfigurasi saat ini menggunakan Keras dengan backend PyTorch. Snapshot deteksi tersimpan di `apps/ai-service/storage/snapshots/`.

Mode Auto memakai `apps/ai-service/models/active/frame_config.json` dan model `model_frame_sugarcane.keras` untuk mendeteksi seluruh frame tertutup tebu selama 3 detik, lalu menjalankan grading selama 30 detik. Lihat [panduan siklus otomatis](apps/ai-service/AUTO_CYCLE.md) untuk pengoperasiannya. Model dan CCTV harus tersedia agar capture menghasilkan data nyata.

## Desktop, mobile, dan deployment

- **Desktop:** jalankan `npm run dev:desktop` setelah API/AI aktif. Alias `npm run dev:dekstop` juga tersedia. Desktop memakai Vite web yang sudah aktif di port 5175, atau menyalakannya bila belum ada. `npm run dev:all` menjalankan layanan, desktop, dan Flutter bila perangkat/toolchain tersedia.
- **Mobile:** ikuti [panduan Flutter](apps/mobile/README.md). Ponsel fisik menggunakan IP LAN/domain server, bukan `localhost`.
- **Web melalui gateway:** ikuti [panduan server Windows](deploy/README.md) untuk build, Nginx, dan Cloudflare Tunnel. `npm run dev:web` hanya membuka layanan pada komputer lokal.

Alamat frontend dapat diubah melalui `apps/web/.env.local` atau environment proses: `VITE_API_URL` dan `VITE_WS_URL`. Fitur AI menggunakan `/api/ai` melalui backend; atur `AI_SERVICE_URL` di server, bukan alamat localhost pada browser pengguna. Perubahan konfigurasi frontend memerlukan restart Vite atau rebuild. Jangan menaruh secret dalam variabel `VITE_*`.

### Satu kode untuk web dan desktop

Semua tampilan, komponen, CSS, dan logika frontend dikerjakan di **`apps/web/src/`**. Folder `apps/desktop/` hanya berisi jendela Electron, preload, dan konfigurasi khusus desktop; tidak ada salinan UI yang perlu diedit.

Saat pengembangan, browser dan desktop membuka sumber React yang sama melalui Vite. Simpan perubahan React/CSS, lalu keduanya diperbarui otomatis tanpa build ulang atau membuka ulang desktop. Perubahan pada kode Electron di `apps/desktop/src/` memerlukan restart `npm run dev:desktop`.

Untuk membuka keduanya sekaligus, jalankan `npm run dev:web`, kemudian `npm run dev:desktop` di terminal kedua. Jika hanya desktop yang dijalankan, UI web juga bisa dibuka di http://127.0.0.1:5175 selama desktop aktif. API/AI tetap dijalankan seperti sebelumnya. Menutup desktop tidak menghentikan server milik `dev:web`; Vite yang dinyalakan oleh desktop sendiri ikut berhenti saat desktop ditutup. Port 5175 harus tersedia atau digunakan oleh Vite dari project ini.

Installer desktop menggunakan hasil build dari `apps/web` yang sama melalui `npm run package -w @sugarcane/desktop`. Aplikasi yang sudah diinstal menerima perubahan UI setelah paket baru dibuild dan dipasang; pembaruan langsung lewat Vite hanya berlaku saat pengembangan. Desktop tetap dapat membuka UI hasil build tanpa server Vite.

## Build dan pemeriksaan

```powershell
npm run build
npm run typecheck
npm run check:ready
```

Build web berada di `apps/web/dist/`.

`check:ready` hanya membaca status. Untuk instalasi dua pabrik, atur `REQUIRED_CAMERA_IDS=1,2`; default pemeriksaan adalah kamera 2 (Trangkil).

Lihat [hasil audit kesiapan](docs/readiness.md) untuk cakupan verifikasi dan batasan distribusi mobile.

## Struktur proyek

```text
apps/web/           UI React
apps/api/           API, autentikasi, dan data aplikasi
apps/ai-service/    CCTV, inferensi, dan database AI
apps/desktop/       Electron
apps/mobile/        Flutter
database/postgres/  Migrasi database aplikasi
scripts/            Startup dan build
docs/               Dokumentasi teknis
```

Jika aplikasi gagal berjalan, periksa koneksi PostgreSQL, konfigurasi `.env`, dependensi Python, serta port 4110/5175/8010 yang mungkin sudah digunakan. Detail tersedia di [akses pengguna](docs/access-control.md) dan [database](docs/database.md). Daftar endpoint AI tersedia di http://127.0.0.1:8010/docs saat layanan aktif.
