# Tebu AI - AI Grading Sugarcane

Aplikasi inspeksi mutu tebu menggunakan CCTV, model AI, dan PostgreSQL. Tersedia web React, desktop Electron, serta klien mobile Flutter untuk Android/iOS.

**Web dan desktop menggunakan satu sumber UI di `apps/web/src/`.** Saat pengembangan, perubahan React/CSS langsung diperbarui pada keduanya. API dan layanan AI digunakan bersama.

Panduan utama ini untuk **Windows dengan PowerShell**. Semua perintah dijalankan dari akar proyek, kecuali jika disebutkan berbeda. Untuk Git Bash, lihat [catatan terminal](#catatan-powershell-dan-git-bash).

## Daftar isi

- [1. Persiapkan perangkat lunak](#1-persiapkan-perangkat-lunak)
- [2. Unduh kode proyek](#2-unduh-kode-proyek)
- [3. Instal dependensi](#3-instal-dependensi)
- [4. Atur konfigurasi lokal](#4-atur-konfigurasi-lokal)
- [5. Siapkan database](#5-siapkan-database)
- [6. Siapkan model AI dan CCTV](#6-siapkan-model-ai-dan-cctv)
- [7. Jalankan web](#7-jalankan-web)
- [8. Jalankan desktop](#8-jalankan-desktop)
- [9. Gunakan aplikasi](#9-gunakan-aplikasi)
- [Menjalankan kembali dan menghentikan aplikasi](#menjalankan-kembali-dan-menghentikan-aplikasi)
- [Build dan pemeriksaan](#build-dan-pemeriksaan)
- [Mobile dan akses melalui jaringan](#mobile-dan-akses-melalui-jaringan)
- [Memperbarui instalasi](#memperbarui-instalasi)
- [Pemecahan masalah](#pemecahan-masalah)
- [Struktur proyek dan dokumentasi](#struktur-proyek-dan-dokumentasi)

## 1. Persiapkan perangkat lunak

| Perangkat lunak | Kebutuhan |
| --- | --- |
| [Git for Windows](https://git-scm.com/downloads/win) | Mengunduh dan memperbarui repository. |
| [Node.js dan npm](https://nodejs.org/en/download) | Node.js minimal **22.12.0**, sesuai `package.json`. npm disertakan dalam instalasi Node.js. |
| [Python 64-bit](https://www.python.org/downloads/windows/) | Layanan AI dan dependensi di `apps/ai-service/requirements.txt`. Verifikasi lokal proyek menggunakan Python **3.14**. |
| [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) **atau** [PostgreSQL](https://www.postgresql.org/download/windows/) | Pilih salah satu cara penyediaan database. Docker Compose proyek memakai PostgreSQL **16**. |
| File model dan akses CCTV | Diperlukan untuk inferensi, live stream, serta inspeksi manual/Auto. File model disediakan terpisah. |

Setelah instalasi, buka terminal baru dan periksa:

```powershell
git --version
node --version
npm --version
python --version
```

Jika memakai Docker, jalankan Docker Desktop sampai siap, kemudian:

```powershell
docker --version
docker compose version
```

Flutter dan Android SDK hanya diperlukan untuk mobile. Keduanya tidak diperlukan untuk menjalankan web atau desktop Electron.

## 2. Unduh kode proyek

Untuk instalasi baru, buka PowerShell di folder tempat proyek ingin disimpan:

```powershell
git clone https://github.com/AI-Grading-Sugarcane/AI-Grading-Sugarcane.git
cd AI-Grading-Sugarcane
```

Jika proyek sudah tersedia di komputer ini, cukup buka foldernya:

```powershell
cd D:\xoora\AI-Grading-Sugarcane
```

Pilih salah satu cara di atas. Akar proyek adalah folder yang berisi `package.json`, `.env.example`, dan `docker-compose.yml`.

## 3. Instal dependensi

### Dependensi JavaScript

```powershell
npm ci
```

Perintah ini memasang dependensi web, API, dan Electron melalui npm workspaces. Unduhan Electron dapat membuat instalasi pertama lebih lama.

### Dependensi Python

Buat virtual environment sekali pada instalasi awal:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r apps/ai-service/requirements.txt
```

Pastikan Python yang aktif berasal dari proyek:

```powershell
python -c "import sys; print(sys.executable)"
```

Hasilnya harus mengarah ke `.venv\Scripts\python.exe`. Aktifkan `.venv` kembali setiap membuka terminal baru yang akan menjalankan layanan AI atau `npm run dev:web`.

Jika PowerShell memblokir `Activate.ps1`, lihat [catatan terminal](#catatan-powershell-dan-git-bash).

## 4. Atur konfigurasi lokal

Salin contoh konfigurasi jika `.env` belum ada:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Jangan menimpa `.env` instalasi lama dengan contoh baru. File ini menyimpan konfigurasi lokal dan tidak diunggah ke Git.

### Koneksi layanan dan database

Untuk Docker Compose bawaan, connection string awalnya:

```dotenv
NODE_ENV=development
API_HOST=127.0.0.1
API_PORT=4110
WEB_ORIGIN=http://127.0.0.1:5175
DATABASE_URL=postgresql://sugarcane:sugarcane@127.0.0.1:5432/sugarcane
AI_DATABASE_URL=postgresql://sugarcane:sugarcane@127.0.0.1:5432/sugarcane_ai
DATABASE_REQUIRED=true
AI_SERVICE_URL=http://127.0.0.1:8010
```

Nilai user/password `sugarcane` sesuai `docker-compose.yml` untuk pengembangan lokal. Jika memakai PostgreSQL sendiri, sesuaikan user, password, host, dan port pada **kedua** URL. Karakter khusus pada user/password di dalam URL harus di-URL-encode.

### Secret dan akun login

Ganti seluruh placeholder `ganti_dengan_...` dalam `.env` dengan nilai Anda sendiri. Buat secret acak dengan:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Salin hasilnya ke `JWT_SECRET`. API dan AI membaca `.env` akar proyek yang sama. Jika memakai override `AI_SERVICE_TOKEN`, nilainya juga harus sama pada kedua layanan.

| Akun | Variabel username | Variabel password |
| --- | --- | --- |
| Developer platform | `APP_DEVELOPER_USER` | `APP_DEVELOPER_PASSWORD` |
| Admin platform | `APP_ADMIN_USER` | `APP_ADMIN_PASSWORD` |
| Admin Trangkil | `USER_TRANGKIL_ADMIN` | `PASSWORD_TRANGKIL_ADMIN` |
| Operator Trangkil | `USER_TRANGKIL_OPERATOR` | `PASSWORD_TRANGKIL_OPERATOR` |
| Admin Kebon Agung | `USER_KEBONAGUNG_ADMIN` | `PASSWORD_KEBONAGUNG_ADMIN` |
| Operator Kebon Agung | `USER_KEBONAGUNG_OPERATOR` | `PASSWORD_KEBONAGUNG_OPERATOR` |

Akun bootstrap dibuat saat API pertama kali berjalan apabila password diisi dan username belum terdaftar. Login memakai nilai yang Anda isi, bukan password contoh. Mengganti password dalam `.env` **tidak mengganti password akun yang sudah tersimpan**; kelola akun tersebut melalui menu Users & Roles dengan hak akses yang sesuai.

### CCTV

Isi URL RTSP kamera yang digunakan:

```dotenv
CCTV_KEBONAGUNG_RTSP_URL=rtsp://USER:PASSWORD@ALAMAT_KAMERA:554/PATH_STREAM
CCTV_TRANGKIL_RTSP_URL=rtsp://USER:PASSWORD@ALAMAT_KAMERA:554/PATH_STREAM
```

Ganti contoh dengan URL sebenarnya. Jika hanya satu kamera digunakan, biarkan variabel kamera lainnya kosong. Komputer harus dapat menjangkau jaringan kamera/VPN.

Nilai ini dipakai untuk mengisi kamera pada instalasi baru. Mengubah `.env` tidak menimpa konfigurasi kamera yang sudah tersimpan di database; perubahan konfigurasi yang sudah ada perlu dilakukan pada data kamera melalui API yang berwenang.

## 5. Siapkan database

Proyek menggunakan dua database:

| Database | Isi |
| --- | --- |
| `sugarcane` | Akun, role, kamera aplikasi, capture, inspeksi, dan persetujuan. |
| `sugarcane_ai` | Konfigurasi kamera AI, hasil inferensi mentah, dan siklus AI. |

### Pilihan A: Docker Compose

Pastikan Docker Desktop aktif, lalu jalankan:

```powershell
npm run db:up
docker compose ps
```

Tunggu layanan `postgres` berstatus **healthy**, kemudian:

```powershell
npm run db:migrate
```

Database aplikasi dibuat oleh container saat volume baru diinisialisasi. Migrasi aplikasi berada di `database/postgres/`. Layanan AI menyiapkan database AI beserta tabelnya saat startup.

Jika port 5432 sudah digunakan PostgreSQL lain, pilih instalasi tersebut atau ubah pemetaan port Docker beserta kedua URL dalam `.env` sebelum melanjutkan.

### Pilihan B: PostgreSQL yang sudah terpasang

Lewati `npm run db:up`. Melalui pgAdmin atau `psql`, siapkan database `sugarcane` dan `sugarcane_ai` dengan owner/user yang sesuai `.env` dan izin membuat tabel.

Jika layanan AI diminta membuat database AI sendiri, user PostgreSQL memerlukan izin `CREATEDB`. Jika tidak memiliki izin tersebut, administrator dapat membuat `sugarcane_ai` terlebih dahulu.

Setelah kedua connection string benar:

```powershell
npm run db:migrate
```

Migrasi tabel AI berjalan saat layanan AI dimulai. Detail tersedia di [panduan database](docs/database.md).

## 6. Siapkan model AI dan CCTV

**Clone Git tidak menyertakan file model Keras/ONNX yang diabaikan oleh `.gitignore`.** Dapatkan file model dari pengelola proyek, lalu letakkan sesuai konfigurasi:

| Fungsi | Konfigurasi | File model sesuai konfigurasi saat ini |
| --- | --- | --- |
| Klasifikasi mutu | `apps/ai-service/models/active/config.json` | `apps/ai-service/models/active/v0.0.1.sugarcane.keras` |
| Deteksi full-frame untuk Auto | `apps/ai-service/models/active/frame_config.json` | `apps/ai-service/models/active/model_frame_sugarcane.keras` |

Periksa keberadaan kedua file:

```powershell
Test-Path apps/ai-service/models/active/v0.0.1.sugarcane.keras
Test-Path apps/ai-service/models/active/model_frame_sugarcane.keras
```

Masing-masing harus menghasilkan `True`. Bila file model berbeda, sesuaikan `model_path` dan konfigurasi input/output dengan model tersebut. Urutan `classes` harus sesuai keluaran model.

Untuk penulisan path, `apps/ai-service/...` dihitung dari akar proyek; `models/active/...` dihitung dari folder `apps/ai-service`. Karena itu, path pada `frame_config.json` tetap menunjuk folder model layanan AI.

Model Keras saat ini dijalankan menggunakan backend PyTorch. Dependensinya dipasang melalui `requirements.txt`.

Kamera bawaan memakai ID **1 untuk Kebon Agung** dan **2 untuk Trangkil**. ROI dapat disesuaikan pada kontrol kamera di dashboard. Tanpa model yang sesuai atau koneksi CCTV, tampilan aplikasi dapat terbuka tetapi inspeksi tidak menghasilkan capture AI yang valid.

## 7. Jalankan web

Setelah instalasi, `.env`, database, model, dan CCTV siap:

```powershell
.\.venv\Scripts\Activate.ps1
npm run dev:web
```

Perintah ini menjalankan **API, web Vite, dan AI sekaligus**. Biarkan terminal tetap terbuka, lalu buka **http://127.0.0.1:5175** di browser.

| Layanan | Alamat default |
| --- | --- |
| Web | http://127.0.0.1:5175 |
| Health API | http://127.0.0.1:4110/health |
| Health AI | http://127.0.0.1:8010/health |
| Dokumentasi endpoint AI | http://127.0.0.1:8010/docs |

Untuk memeriksa layanan dari terminal lain:

```powershell
Invoke-RestMethod http://127.0.0.1:4110/health
Invoke-RestMethod http://127.0.0.1:8010/health
```

Respons health menunjukkan layanan merespons; ketersediaan kamera/model tetap perlu diperiksa pada statusnya. Endpoint kontrol AI memerlukan token layanan internal dan diakses aplikasi melalui backend `/api/ai`.

## 8. Jalankan desktop

### Web dan desktop bersamaan

Biarkan `npm run dev:web` berjalan di terminal pertama. Buka terminal kedua:

```powershell
cd D:\xoora\AI-Grading-Sugarcane
npm run dev:desktop
```

Jendela Electron akan terbuka dan memakai UI Vite yang sama. Alias lama berikut juga tetap tersedia:

```powershell
npm run dev:dekstop
```

**`dev:desktop` tidak menyalakan API dan AI.** Perintah ini memakai Vite yang sudah aktif di port 5175, atau menyalakan UI Vite sendiri jika belum ada.

### Desktop tanpa menjalankan perintah web gabungan

Gunakan tiga terminal dari akar proyek:

| Terminal | Perintah |
| --- | --- |
| 1 - API | `npm run dev:api` |
| 2 - AI | Aktifkan `.venv`, kemudian `npm run dev:ai`. |
| 3 - Desktop dan UI | `npm run dev:desktop` |

Alternatif setelah seluruh persiapan selesai adalah mengaktifkan `.venv` lalu menjalankan `npm run dev:all`. Skrip Windows ini memeriksa database, menerapkan migrasi, serta menjalankan API, AI, web, dan desktop. Jika Flutter serta perangkat Android tersedia, skrip juga mencoba menjalankan mobile. Skrip ini membuka API ke LAN (`API_HOST=0.0.0.0`); gunakan langkah web/desktop di atas jika hanya memerlukan akses lokal.

### Satu sumber kode UI

Edit tampilan, komponen, CSS, dan logika frontend di **`apps/web/src/`**. Perubahan tersebut diperbarui otomatis di browser dan Electron selama mode development berjalan.

- Perubahan kode khusus Electron di `apps/desktop/src/` memerlukan restart desktop.
- Menutup desktop tidak menghentikan Vite milik terminal `dev:web`.
- Vite yang dimulai oleh desktop sendiri berhenti bersama proses desktop.
- Aplikasi desktop yang sudah diinstal memakai UI hasil build. Perubahan kode masuk ke instalasi tersebut setelah paket baru dibangun dan dipasang.

## 9. Gunakan aplikasi

1. Login memakai akun yang disiapkan dalam `.env`. Gunakan akun operator pabrik yang sesuai untuk inspeksi operasional.
2. Pilih pabrik/kamera dan pastikan status kamera terhubung serta model tersedia.
3. Sesuaikan ROI agar area inspeksi sesuai tampilan kamera.
4. Untuk inspeksi manual, gunakan **Mulai Manual**, lalu **Stop** untuk menyelesaikan siklus.
5. Untuk inspeksi otomatis, aktifkan **Auto**. Model full-frame harus mengenali tebu menutupi frame secara kontinu selama 3 detik; grading berjalan hingga 30 detik. Siklus berikutnya menunggu area kembali kosong.
6. Periksa capture, grade, confidence, serta riwayat inspeksi. Menu dan tindakan mengikuti izin akun.

Grade **T** menunggu keputusan QC secara manual. Metrik kotoran yang tidak diukur model ditampilkan sebagai **"Tidak diukur"**; probabilitas kelas mutu tidak diperlakukan sebagai pengukuran fisik kotoran.

Detail: [alur Auto](apps/ai-service/AUTO_CYCLE.md) dan [akses pengguna](docs/access-control.md).

## Menjalankan kembali dan menghentikan aplikasi

Instalasi dependensi serta pembuatan `.venv` tidak perlu diulang setiap hari. Untuk pemakaian berikutnya:

```powershell
cd D:\xoora\AI-Grading-Sugarcane
.\.venv\Scripts\Activate.ps1
npm run db:up
npm run dev:web
```

Lewati `db:up` jika memakai PostgreSQL sendiri; pastikan servicenya aktif. Untuk desktop, jalankan `npm run dev:desktop` di terminal kedua.

Selesaikan inspeksi yang sedang berjalan sebelum menghentikan layanan. Tekan **Ctrl+C** pada terminal layanan untuk menghentikannya. Jika ingin menghentikan database Docker setelah layanan aplikasi selesai:

```powershell
npm run db:down
```

Perintah tersebut mempertahankan volume data. Hindari `docker compose down -v` pada instalasi berisi data karena opsi `-v` menghapus volume database.

## Build dan pemeriksaan

### Build web, API, dan desktop

```powershell
npm run typecheck
npm run build
```

| Hasil | Lokasi |
| --- | --- |
| Web | `apps/web/dist/` |
| API | `apps/api/dist/` |
| Kode utama Electron | `apps/desktop/dist/` |

### Pemeriksaan kesiapan lokal

Dengan API dan AI berjalan, gunakan terminal lain dari akar proyek:

```powershell
npm run check:ready
```

Perintah ini hanya membaca konfigurasi, database, model, layanan, kamera, dan keberadaan build UI. Jalankan build terlebih dahulu agar pemeriksaan hasil build dapat lulus. Kamera wajib default adalah **2 (Trangkil)**. Bila kedua pabrik diwajibkan, isi `REQUIRED_CAMERA_IDS=1,2` pada `.env`.

### Membuat installer desktop Windows

```powershell
npm run package -w @sugarcane/desktop
```

Hasilnya berada di `apps/desktop/release/`, termasuk installer NSIS `TebuAI Setup 0.1.0.exe` untuk versi desktop saat ini. Paket tersebut berisi klien desktop dan UI web hasil build; PostgreSQL, API, AI, dan model tetap dijalankan pada server/komputer backend.

Alamat backend default desktop adalah `http://127.0.0.1:4110`. Untuk backend lain, tetapkan environment `SUGARCANE_API_URL` sebelum membuka desktop, misalnya `$env:SUGARCANE_API_URL = "https://api.example.com"`. Variabel ini dibaca dari environment proses, bukan otomatis dari `.env` akar proyek. Lihat [panduan desktop](docs/desktop.md).

Untuk akses web melalui server/gateway, ikuti [panduan deployment Windows](deploy/README.md). `npm run dev:web` adalah mode pengembangan lokal.

## Mobile dan akses melalui jaringan

Mobile merupakan klien Flutter terpisah yang memakai API yang sama. Setelah Flutter dan toolchain Android tersedia:

```powershell
cd apps/mobile
flutter doctor
flutter pub get
flutter run
```

Gunakan alamat API yang dapat dijangkau perangkat:

| Perangkat | Contoh alamat API |
| --- | --- |
| Android Emulator pada komputer backend | `http://10.0.2.2:4110` |
| Ponsel fisik di LAN | `http://IP-LAN-KOMPUTER:4110` |
| Server publik | Domain API melalui HTTPS |

Untuk LAN, backend perlu `API_HOST=0.0.0.0`, jaringan harus saling terhubung, dan firewall harus mengizinkan koneksi API. `localhost` pada ponsel mengarah ke ponsel itu sendiri. Build iOS memerlukan macOS/Xcode; build Android memerlukan Android SDK. Detail instalasi dan signing tersedia di [panduan mobile](apps/mobile/README.md).

Frontend web membaca konfigurasi `VITE_API_URL` dan `VITE_WS_URL` melalui environment proses atau file seperti `apps/web/.env.local`; proxy development dapat diarahkan dengan environment `VITE_BACKEND_URL`. Setelah mengubah konfigurasi frontend, restart Vite atau build ulang. Jangan menaruh secret dalam `VITE_*`, karena nilainya dapat masuk ke kode browser. Fitur AI tetap melalui backend; `AI_SERVICE_URL` dikonfigurasi pada server.

## Memperbarui instalasi

Simpan atau commit perubahan lokal sebelum menarik pembaruan. Backup database dan file operasional sebelum memperbarui instalasi yang sudah dipakai. Dari akar proyek, hentikan layanan aplikasi lalu:

```powershell
git pull --ff-only
npm ci
.\.venv\Scripts\Activate.ps1
python -m pip install -r apps/ai-service/requirements.txt
npm run db:migrate
npm run build
npm run dev:web
```

Jangan menyalin ulang `.env.example` ke `.env` yang sudah berisi konfigurasi. Bandingkan contoh konfigurasi terbaru dan tambahkan variabel yang diperlukan. Model, database, serta konfigurasi lokal tidak diunduh ulang oleh `git pull`. Untuk desktop terpasang, bangun dan pasang kembali paketnya setelah perubahan UI.

## Pemecahan masalah

| Kendala | Pemeriksaan dan langkah berikutnya |
| --- | --- |
| `node`, `npm`, `python`, atau `git` tidak dikenali | Periksa instalasi dan PATH, lalu buka terminal baru. |
| `npm.ps1` atau `Activate.ps1` diblokir | Gunakan langkah pada catatan terminal di bawah. |
| `ModuleNotFoundError` saat AI dimulai | Aktifkan `.venv` pada terminal yang menjalankan AI, lalu ulangi instalasi `requirements.txt`. |
| `No matching distribution found` ketika pip memasang modul | Periksa versi/arsitektur Python terhadap dukungan paket; gunakan Python 64-bit yang kompatibel. Verifikasi lokal memakai Python 3.14. |
| Docker tidak dapat dihubungi | Buka Docker Desktop dan tunggu engine siap; periksa `docker compose ps`. |
| Koneksi database ditolak atau autentikasi gagal | Periksa server PostgreSQL dan kedua URL dalam `.env`. Mengganti password Compose tidak mengganti password pada volume database lama. |
| Tabel seperti `roles` atau kolom `impurity_measured` tidak ditemukan | Jalankan `npm run db:migrate`. Tabel AI dibuat saat layanan AI dimulai. |
| Login gagal | Gunakan password akun tersimpan. Perubahan `.env` hanya membuat akun yang belum ada; tidak mereset password lama. |
| Port 4110, 5175, atau 8010 sudah dipakai | Hentikan terminal layanan ganda. Jalankan `dev:web` sekali; desktop dapat memakai Vite yang sama. Port 5175 harus digunakan proyek ini atau tersedia. |
| Desktop hanya menampilkan pesan UI bersama | Tunggu build/unduhan Electron; periksa pesan error berikutnya. Pastikan `ELECTRON_RUN_AS_NODE` tidak diatur manual. Jika binary Electron hilang, jalankan `node apps/desktop/scripts/ensure-electron.cjs` dari akar proyek. |
| Desktop terbuka tetapi data/login gagal | Pastikan API dan AI aktif. `dev:desktop` tidak memulai kedua layanan tersebut. |
| Kamera offline atau tidak ada gambar | Periksa URL RTSP, user/password kamera, VPN/jaringan, kamera yang dipilih, dan konfigurasi kamera tersimpan. |
| Model tidak tersedia | Periksa kedua file model serta `model_path`. File model tidak ikut clone Git. |
| Auto tidak memulai siklus | Periksa model full-frame, koneksi kamera, ROI, dan konfirmasi full-frame kontinu 3 detik. |
| Kontrol AI langsung mengembalikan 401 | Endpoint AI dilindungi token layanan internal. Gunakan aplikasi/backend dan pastikan secret API/AI sama. |

Untuk melihat proses pemakai port di PowerShell:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 4110,5175,8010 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

### Catatan PowerShell dan Git Bash

Jika aktivasi `.venv` diblokir PowerShell, izinkan skrip **hanya pada terminal saat ini**, lalu ulangi aktivasi:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Jika `npm.ps1` diblokir, gunakan `npm.cmd` sebagai pengganti `npm`, misalnya `npm.cmd run dev:web`. Alternatif menjalankan AI tanpa aktivasi virtual environment:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir apps/ai-service --host 127.0.0.1 --port 8010 --reload
```

Pada Git Bash, perintah npm tetap sama. Gunakan sintaks berikut untuk berpindah folder dan mengaktifkan `.venv`:

```bash
cd /d/xoora/AI-Grading-Sugarcane
source .venv/Scripts/activate
npm run dev:web
```

Langkah PowerShell seperti `Copy-Item`, `Test-Path`, dan `$env:...` perlu dijalankan di PowerShell atau disesuaikan ke sintaks Bash.

## Struktur proyek dan dokumentasi

```text
apps/
  web/                  UI React bersama untuk browser dan Electron
  api/                  Fastify, autentikasi, dan data aplikasi
  ai-service/           CCTV, inferensi Python, model aktif, dan snapshot
  desktop/              Jendela Electron, preload, dan server UI desktop
  mobile/               Klien Flutter Android/iOS
database/postgres/     Migrasi database aplikasi
scripts/               Perintah startup, build, dan pemeriksaan kesiapan
deploy/                Konfigurasi gateway/deployment Windows
docs/                  Dokumentasi teknis
```

Folder `.runtime/` dipakai perangkat deployment/log lokal bila diaktifkan. File model aktif berada di `apps/ai-service/models/active/`; `models/archive/` menampung model unggahan. Snapshot inferensi berada di `apps/ai-service/storage/snapshots/`.

- [Database dan migrasi](docs/database.md)
- [Akses pengguna dan role](docs/access-control.md)
- [Desktop Electron](docs/desktop.md)
- [Mobile Flutter](apps/mobile/README.md)
- [Siklus Auto](apps/ai-service/AUTO_CYCLE.md)
- [Deployment Windows](deploy/README.md)
- [Catatan hasil audit dan batasan kesiapan](docs/readiness.md)
