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

Lihat [panduan AI service](apps/ai-service/README_FLOW.md) untuk detail. Model dan CCTV harus tersedia agar capture menghasilkan data nyata.

## Desktop, mobile, dan deployment

- **Desktop:** jalankan `npm run dev:desktop` setelah API/AI aktif. `npm run dev:all` menjalankan layanan, desktop, dan Flutter bila perangkat/toolchain tersedia.
- **Mobile:** ikuti [panduan Flutter](apps/mobile/README.md). Ponsel fisik menggunakan IP LAN/domain server, bukan `localhost`.
- **Web melalui gateway:** ikuti [panduan server Windows](deploy/README.md) untuk build, Nginx, dan Cloudflare Tunnel. `npm run dev:web` hanya membuka layanan pada komputer lokal.

Alamat frontend dapat diubah melalui `apps/web/.env.local` atau environment proses: `VITE_API_URL`, `VITE_WS_URL`, dan `VITE_AI_SERVICE_URL`. Perubahan memerlukan restart Vite atau rebuild. Jangan menaruh secret dalam variabel `VITE_*`.

## Build dan pengujian

```powershell
npm run build
npm run typecheck
npm test
```

Build web berada di `apps/web/dist/`. Tes integrasi (`npm run test:integration`) membutuhkan PostgreSQL dengan izin membuat schema uji. Tes Python dijalankan dengan `npm run test:ai` ketika `.venv` aktif.

## Struktur proyek

```text
apps/web/           UI React
apps/api/           API, autentikasi, dan data aplikasi
apps/ai-service/    CCTV, inferensi, dan database AI
apps/desktop/       Electron
apps/mobile/        Flutter
packages/contracts/ Kontrak TypeScript bersama
database/postgres/  Migrasi database aplikasi
scripts/            Startup dan build
tests/              Tes regresi dan integrasi
docs/               Dokumentasi teknis
```

Jika aplikasi gagal berjalan, periksa koneksi PostgreSQL, konfigurasi `.env`, dependensi Python, serta port 4110/5175/8010 yang mungkin sudah digunakan. Detail tersedia di [API](docs/api.md), [akses pengguna](docs/access-control.md), dan [database](docs/database.md).
