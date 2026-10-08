# Sugarcane AI Platform — Tebu AI

Platform inspeksi mutu tebu berbasis CCTV dan AI untuk operasional pabrik gula. **React Web**, **Electron Desktop**, dan **Flutter Mobile** memakai satu backend bisnis dan PostgreSQL agar kamera, hasil inspeksi, riwayat truk, pengguna, dan persetujuan dikelola bersama.

Repository ini berbentuk monorepo. Web dan desktop berbagi antarmuka React; mobile memiliki antarmuka Flutter sendiri. Service Python menangani video RTSP, pemrosesan gambar, dan inferensi ONNX. Implementasi saat ini mencakup konteks PG Trangkil dan PG Kebon Agung.

> Perintah utama menggunakan **Windows PowerShell**, sesuai skrip repository. PostgreSQL wajib tersedia; API tidak memakai fallback data operasional dalam memori. Model ONNX dan koneksi CCTV nyata perlu disediakan untuk menjalankan inspeksi AI.

## Daftar isi

- [Fitur dan status implementasi](#fitur-dan-status-implementasi)
- [Topologi dan alur data](#topologi-dan-alur-data)
- [Framework dan teknologi](#framework-dan-teknologi)
- [Struktur repository](#struktur-repository)
- [Persyaratan](#persyaratan)
- [Instalasi awal](#instalasi-awal)
- [Konfigurasi environment](#konfigurasi-environment)
- [Menjalankan aplikasi](#menjalankan-aplikasi)
- [Menghentikan aplikasi](#menghentikan-aplikasi)
- [Kamera dan model AI](#kamera-dan-model-ai)
- [Alur operasional dan impor tapping](#alur-operasional-dan-impor-tapping)
- [Akun dan hak akses](#akun-dan-hak-akses)
- [Database dan penyimpanan](#database-dan-penyimpanan)
- [API dan komunikasi realtime](#api-dan-komunikasi-realtime)
- [Build dan pengemasan](#build-dan-pengemasan)
- [Pengujian dan pemeriksaan kualitas](#pengujian-dan-pemeriksaan-kualitas)
- [Troubleshooting](#troubleshooting)
- [Deployment](#deployment)
- [Panduan perubahan kode dan dokumentasi](#panduan-perubahan-kode-dan-dokumentasi)

## Fitur dan status implementasi

| Area | Kemampuan yang tersedia |
| --- | --- |
| Monitoring | Dashboard, status service, kamera, deteksi, confidence, dan ringkasan mutu |
| Inspeksi | Mulai/selesaikan siklus truk, capture, agregasi, keputusan akhir, riwayat lintas perangkat |
| Mutu tebu | Persentase daun/pucuk/sampah; kelas S, M, A, D, B, G, X; grade dihitung backend |
| Rekonsiliasi | Impor Excel/CSV tapping pada web/desktop, pencocokan meja dan waktu, koreksi manual |
| Kamera | Konfigurasi RTSP, stream MJPEG, snapshot, reconnect, dan ROI sesuai izin |
| Model | Daftar, unggah ONNX, aktivasi model dengan validasi service AI |
| Akses | Login, role developer/admin/operator/viewer, role kustom, pengelolaan pengguna |
| Persetujuan | Permintaan penghapusan dan review tersimpan di PostgreSQL |
| Mobile | Dashboard, history/CSV, inspeksi, kamera, model, pengguna, pengaturan, sesi aman |

**Batas implementasi:** desktop merupakan klien, bukan paket server/database. Sinkronisasi offline ke server pusat belum tersedia. Auto Stop memerlukan deteksi conveyor kosong yang belum disediakan service AI saat ini. Build iOS memerlukan macOS. Akurasi model dan alur CCTV produksi perlu diuji dengan perangkat serta model operasional.

## Topologi dan alur data

### Topologi implementasi saat ini

```mermaid
flowchart LR
    subgraph Clients[Klien]
        Web[React Web]
        Desktop[Electron + React]
        Mobile[Flutter Mobile]
    end
    subgraph Server[Komputer pengembangan atau server pabrik]
        API[Fastify API :4110]
        DB[(PostgreSQL :5432)]
        AI[FastAPI + ONNX Runtime :8010]
        Files[(Model, ROI, dan snapshot)]
    end
    Camera[CCTV atau NVR RTSP]
    Web -->|REST dan WebSocket| API
    Desktop -->|REST dan WebSocket| API
    Mobile -->|REST dan WebSocket| API
    API -->|SQL| DB
    API -->|Inferensi, konfigurasi, proxy media| AI
    Camera -->|Video RTSP| AI
    Web -.->|MJPEG langsung saat ini| AI
    Desktop -.->|MJPEG langsung saat ini| AI
    AI -->|Baca model dan simpan snapshot| Files
    API -->|Unggah model dan baca snapshot| Files
```

Data bisnis dan autentikasi semua klien melalui API; klien tidak terhubung langsung ke PostgreSQL. **Video web/desktop saat ini menggunakan URL AI langsung** melalui `getCameraStreamUrl()`. API juga menyediakan proxy stream/snapshot. Host AI perlu dapat dijangkau web/desktop untuk video pada konfigurasi saat ini. Ini berbeda dari rancangan deployment yang menempatkan semua media di balik gateway.

API dan AI menggunakan struktur direktori model/snapshot repository yang sama. Jika keduanya dipisahkan ke container/host berbeda, sediakan volume bersama dengan path konsisten atau implementasikan penyimpanan bersama terlebih dahulu.

### Alur satu inspeksi

1. Pengguna login; API mengembalikan token dan hak akses.
2. Operator memilih kamera/meja dan memulai siklus inspeksi truk.
3. Klien meminta capture ke API; backend memeriksa izin dan lingkup pabrik.
4. AI mengambil frame CCTV, menerapkan ROI bila aktif, melakukan inferensi, dan menyimpan snapshot.
5. API menghitung grade dari persentase kelas, menyimpan hasil di PostgreSQL, dan mengirim event WebSocket.
6. Saat siklus selesai, backend menyimpan agregasi dan hubungan capture dengan inspeksi melalui transaksi.
7. Klien membaca riwayat. Tapping direkonsiliasi melalui web/desktop; koreksi/penghapusan mengikuti izin dan persetujuan.

### Alamat dan port lokal

| Komponen | Default | Keterangan |
| --- | --- | --- |
| Web development | `http://127.0.0.1:5175` | Vite; `localhost:5175` juga dapat digunakan |
| API | `http://127.0.0.1:4110` | REST; health di `/health` |
| WebSocket | `ws://127.0.0.1:4110/ws` | Event dengan autentikasi token |
| AI | `http://127.0.0.1:8010` | Inferensi/MJPEG/ROI; health `/health`, dokumentasi `/docs` |
| PostgreSQL | `127.0.0.1:5432` | Backend dan alat administrasi |
| Web preview | `http://127.0.0.1:5173` | Preview build; backend tetap diperlukan |
| Desktop | File renderer lokal | Tidak membutuhkan Vite saat dijalankan |

## Framework dan teknologi

Versi mengikuti manifest repository, bukan klaim versi terbaru di luar proyek. Resolusi npm lengkap tercatat di `package-lock.json`.

| Lapisan | Teknologi | Peran |
| --- | --- | --- |
| Web | React 19, TypeScript 5.7, Vite 6 | UI, pemeriksaan tipe, development dan build |
| State/UI | Zustand 5, Lucide React, CSS | State, sesi, polling, ikon, tampilan |
| Spreadsheet | SheetJS `xlsx` 0.20.3 | Excel/CSV; dimuat saat impor |
| API | Node.js, Fastify 5, TypeScript, tsx | API HTTP dan watch |
| Validasi/plugin | Zod 3, Fastify CORS/Multipart/WebSocket | Validasi, unggah, event realtime |
| Database | PostgreSQL 16, `pg`, migrasi SQL | Relasi, data operasional, transaksi |
| AI HTTP | Python, FastAPI 0.115.6, Uvicorn 0.34.0, Pydantic 2.10.4 | Service inferensi dan konfigurasi |
| Vision | OpenCV 4.10.0.84, NumPy 2.2.1, ONNX Runtime 1.20.1 | RTSP, ROI, preprocessing, inferensi |
| Desktop | Electron 44.4.1, electron-builder 26.15.3 | Jendela native dan paket Windows |
| Mobile | Flutter, Dart | UI Android/iOS; constraint Dart `^3.13.3` pada pubspec |
| Library mobile | `http`, `flutter_secure_storage`, `file_picker`, `share_plus` | API, sesi aman, file, berbagi hasil |
| Orkestrasi | npm workspaces, concurrently, PowerShell, Docker Compose | Development dan PostgreSQL lokal |
| Pengujian | Node test runner + tsx, Python unittest, Flutter Test | Regresi, integrasi, smoke test |

Sesi memakai token bertanda tangan HMAC dengan masa berlaku delapan jam; nama kuncinya `JWT_SECRET`. Implementasi token saat ini bukan JWT standar tiga bagian. Password disimpan sebagai hash scrypt dengan salt.

## Struktur repository

```text
apps/
  web/                    React; komponen, store, parser tapping, aset
  api/                    Fastify; autentikasi, route, database, grading
  ai-service/             FastAPI; ONNX, worker RTSP, ROI, snapshot
  desktop/                Electron; main, preload, konfigurasi runtime
  mobile/                 Flutter; lib, test, project Android dan iOS
packages/
  contracts/              Tipe kontrak TypeScript bersama
database/
  postgres/               Migrasi PostgreSQL aktif 001–005
  migrations/             Referensi SQL Server lama
models/
  active/                 config.json dan model awal model.onnx
  archive/                Model unggahan; model aktif dapat merujuk ke sini
storage/
  snapshots/              Gambar hasil inferensi
  logs/                   Direktori log yang disiapkan
  export/                 Direktori ekspor yang disiapkan
  roi_config.json         Konfigurasi ROI kamera
scripts/                  Orkestrasi development
tests/                    Regresi frontend, API/PostgreSQL, dan AI
docs/                     Dokumentasi teknis dan laporan verifikasi
.env.example              Contoh environment tanpa secret operasional
docker-compose.yml        PostgreSQL lokal dan named volume
package.json              Workspace dan perintah utama
```

Flutter dan Python dikelola melalui toolchain masing-masing, bukan npm workspace. `.env`, model ONNX, snapshot hasil capture, toolchain lokal, dan hasil build tidak disertakan sebagai source melalui Git.

## Persyaratan

| Kebutuhan | Persyaratan |
| --- | --- |
| Node.js/npm | Node.js **22.12+**, sesuai `engines` root |
| Python | Python **3.10+** yang kompatibel dengan paket `requirements.txt` |
| Database | Docker Desktop + Compose, atau PostgreSQL 16 tersedia |
| Shell | PowerShell untuk `dev:all`; skrip development Electron juga memakai sintaks Windows |
| Android | Flutter/Dart sesuai pubspec, Android SDK, emulator atau ponsel USB debugging |
| iOS | macOS, Flutter SDK, Xcode, konfigurasi signing |
| Inspeksi nyata | Model ONNX sesuai aplikasi, CCTV/NVR RTSP terjangkau, kredensial kamera |

Flutter dicari melalui PATH atau `.toolchains/flutter/bin/flutter.bat`. Folder `.toolchains` tidak diunduh otomatis. GPU tidak diwajibkan oleh konfigurasi inferensi CPU saat ini.

## Instalasi awal

Jalankan dari **akar repository**. Jangan menyalin contoh di atas `.env` yang sudah berisi konfigurasi Anda.

### 1. Environment dan dependensi JavaScript

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm install
```

Edit `.env`: isi password bootstrap, secret, dan alamat layanan. Instalasi pertama membutuhkan akses registry npm serta CDN SheetJS yang ditentukan dalam manifest.

### 2. Python virtual environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r apps/ai-service/requirements.txt
```

Aktifkan `.venv` pada terminal yang menjalankan `dev:ai`, `dev:web`, `dev:all`, atau tes AI, karena skrip memanggil `python`. Bila aktivasi diblokir kebijakan PowerShell, Python virtual environment dapat dipanggil eksplisit:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir apps/ai-service --host 127.0.0.1 --port 8010 --reload
```

### 3. PostgreSQL

Nyalakan Docker Desktop, lalu:

```powershell
npm run db:up
docker compose ps
npm run db:migrate
```

Compose menyediakan database `sugarcane`, user/password lokal `sugarcane`. Jika memakai PostgreSQL sendiri, lewati `db:up`, buat database/user, isi `DATABASE_URL`, dan tetap jalankan migrasi. Tunggu koneksi siap sebelum migrasi/startup API.

### 4. Flutter bila diperlukan

```powershell
cd apps/mobile
flutter pub get
flutter doctor
cd ../..
```

Flutter tidak diperlukan bila hanya menggunakan browser atau Electron. Untuk capture nyata, siapkan kamera/model sebelum menjalankan inspeksi.

## Konfigurasi environment

Gunakan `.env.example` sebagai acuan. API membaca `.env` tanpa menimpa environment proses yang sudah ada. `VITE_*` dibaca saat development/build web; perubahan memerlukan restart Vite atau rebuild.

Vite pada proyek ini berjalan dari `apps/web` dan belum menetapkan `envDir` ke root. Karena itu, untuk mengganti URL frontend, isi `apps/web/.env.local` atau set environment PowerShell sebelum menjalankan Vite/build. Menulis `VITE_*` hanya pada `.env` root belum otomatis mengubah konfigurasi frontend. Untuk nilai yang dibaca langsung oleh `vite.config.ts`, seperti target proxy, gunakan environment proses.

| Variabel | Fungsi |
| --- | --- |
| `NODE_ENV` | `development` lokal; `production` untuk produksi |
| `API_HOST`, `API_PORT` | Bind API, default `127.0.0.1:4110`; gunakan `0.0.0.0` untuk LAN |
| `DATABASE_URL` | Connection string PostgreSQL, wajib untuk backend/migrasi |
| `DATABASE_REQUIRED` | Set `true`; PostgreSQL tetap wajib pada implementasi saat ini |
| `AI_SERVICE_URL` | Alamat AI yang dipanggil backend |
| `VITE_API_URL` | Alamat API browser, prioritas atas `VITE_BACKEND_URL` |
| `VITE_BACKEND_URL` | Alias API dan konfigurasi proxy Vite |
| `VITE_WS_URL` | Alamat WebSocket browser |
| `VITE_AI_SERVICE_URL` | Alamat AI yang dapat dijangkau browser untuk video |
| `JWT_SECRET` | Kunci HMAC token sesi, gunakan nilai panjang dan acak |
| `APP_DEVELOPER_USER`, `APP_DEVELOPER_PASSWORD` | Bootstrap developer |
| `APP_ADMIN_USER`, `APP_ADMIN_PASSWORD` | Bootstrap admin global |
| `USER_TRANGKIL_ADMIN`, `PASSWORD_TRANGKIL_ADMIN` | Admin PG Trangkil |
| `USER_TRANGKIL_OPERATOR`, `PASSWORD_TRANGKIL_OPERATOR` | Operator PG Trangkil |
| `USER_KEBONAGUNG_ADMIN`, `PASSWORD_KEBONAGUNG_ADMIN` | Admin PG Kebon Agung |
| `USER_KEBONAGUNG_OPERATOR`, `PASSWORD_KEBONAGUNG_OPERATOR` | Operator PG Kebon Agung |
| `ADMIN_2FA_PIN` | Override PIN persetujuan admin opsional |
| `WEB_ORIGIN` | Ada pada contoh, tetapi belum membatasi CORS kode API saat ini |

Jangan menaruh password database/RTSP atau secret token dalam `VITE_*`, karena nilainya dapat masuk bundle frontend. Password `.env.example` adalah placeholder. Bootstrap membuat akun bila password diisi dan akun belum ada; perubahan password `.env` tidak otomatis mengubah hash akun tersimpan.

| Klien | Konfigurasi runtime lainnya |
| --- | --- |
| Electron API | `SUGARCANE_API_URL`, atau alias `BACKEND_BASE_URL`; WebSocket diturunkan dari URL API |
| Electron video | `SUGARCANE_AI_SERVICE_URL`, default `http://127.0.0.1:8010` |
| Flutter | `--dart-define=API_BASE_URL=...`, atau alamat server pada login/Pengaturan |

`SUGARCANE_*` harus tersedia pada environment proses Electron; aplikasi tidak otomatis membaca variabel runtime tersebut dari `.env` root.

## Menjalankan aplikasi

### Semua layanan dan klien pada Windows

Setelah instalasi awal dan aktivasi `.venv`:

```powershell
npm run dev:all
```

Skrip memulihkan paket npm, memeriksa listener PostgreSQL, menyalakan database via Docker bila perlu, menjalankan migrasi, lalu membuka API, AI, Vite, dan Electron. Flutter ikut dijalankan bila toolchain/perangkat Android terdeteksi; tanpa Android komponen lain tetap berjalan. Skrip mengikat API ke `0.0.0.0` untuk akses mobile.

Untuk memilih alamat mobile sendiri:

```powershell
npm run dev:all -- -MobileApiUrl http://192.168.1.10:4110
```

Ganti IP contoh dengan IP LAN server. Jangan menjalankan orchestrator bersamaan dengan instance layanan yang sudah memakai port yang sama.

### Web + API + AI

```powershell
npm run dev:web
```

Menjalankan tiga service tanpa Electron/Flutter; PostgreSQL dan migrasi harus siap. Buka `http://127.0.0.1:5175`. `npm run dev` merupakan alias mode ini.

### Layanan terpisah

Jalankan masing-masing pada terminal berbeda dari root:

| Perintah | Komponen |
| --- | --- |
| `npm run dev:api` | Fastify dengan watch |
| `npm run dev:ai` | FastAPI/Uvicorn dengan reload |
| `npm run dev:frontend` | Vite saja |
| `npm run dev:desktop` | Build React dan Electron, lalu buka desktop |

Desktop membutuhkan API/PostgreSQL; AI diperlukan untuk video/capture. Desktop membuka hasil build, sehingga perubahan React memerlukan rebuild/restart, bukan hot reload Vite.

### Mobile

Setelah API berjalan:

```powershell
cd apps/mobile
flutter devices
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4110
```

| Target | Alamat API |
| --- | --- |
| Android Emulator | `http://10.0.2.2:4110` |
| iOS Simulator | `http://127.0.0.1:4110` bila API pada Mac yang sama |
| Ponsel fisik | IP LAN/domain server, misalnya `http://192.168.1.10:4110` |

Ponsel fisik membutuhkan `API_HOST=0.0.0.0`, jaringan yang menjangkau server, dan firewall port 4110 yang sesuai. `localhost` pada ponsel menunjuk ponsel itu sendiri. Gunakan `flutter run -d ID_PERANGKAT --dart-define=API_BASE_URL=http://IP-SERVER:4110` untuk memilih perangkat.

Jika Flutter hanya tersedia lokal, gunakan `..\..\.toolchains\flutter\bin\flutter.bat` sebagai pengganti `flutter` dari `apps/mobile`. Lihat [panduan mobile](apps/mobile/README.md).

### Topologi jaringan LAN

Contoh satu server pabrik melayani beberapa perangkat:

```text
CCTV / NVR -- RTSP --> Server pabrik (contoh IP: 192.168.1.10)
                       |-- PostgreSQL :5432 (internal)
                       |-- API / WebSocket :4110
                       |-- AI / MJPEG :8010
                       |-- Web development :5175
                                |
               +----------------+----------------+
               |                |                |
         Browser LAN      Desktop LAN       Ponsel LAN
```

Untuk browser dari komputer lain, tidak cukup hanya membuka bind API. Vite dan jalur AI video juga harus dapat dijangkau. Contoh pengembangan pada jaringan tepercaya, dijalankan pada **terminal terpisah** dari root:

```powershell
# Terminal API
$env:API_HOST = "0.0.0.0"
npm run dev:api
```

```powershell
# Terminal AI, dengan .venv aktif
python -m uvicorn main:app --app-dir apps/ai-service --host 0.0.0.0 --port 8010 --reload
```

```powershell
# Terminal web; ganti IP dengan IP server
$env:VITE_API_URL = "http://192.168.1.10:4110"
$env:VITE_BACKEND_URL = "http://192.168.1.10:4110"
$env:VITE_WS_URL = "ws://192.168.1.10:4110/ws"
$env:VITE_AI_SERVICE_URL = "http://192.168.1.10:8010"
npm run dev -w @sugarcane/web -- --host 0.0.0.0
```

Buka `http://192.168.1.10:5175` dari browser LAN. Desktop remote memakai `SUGARCANE_API_URL` dan `SUGARCANE_AI_SERVICE_URL`; mobile memakai alamat API. Batasi firewall pada jaringan/perangkat yang diperlukan dan gunakan gateway berproteksi untuk produksi. PostgreSQL tidak perlu dibuka ke klien. Mode `dev:all` standar tidak otomatis membuka Vite/AI ke LAN.

## Menghentikan aplikasi

- Tekan **Ctrl + C** pada terminal `dev:all`/`dev:web` untuk menghentikan proses orchestrator.
- Untuk service terpisah, tekan **Ctrl + C** pada setiap terminal. Bila muncul `Terminate batch job (Y/N)?`, jawab `Y`.
- Tutup Electron yang masih terbuka. Pada sesi `flutter run`, tekan `q` untuk keluar; aplikasi terpasang pada ponsel mungkin perlu ditutup sendiri.
- Menghentikan aplikasi tidak otomatis menghentikan PostgreSQL Docker.

Dari root:

```powershell
npm run db:down
```

Named volume database tetap tersimpan. **`docker compose down -v` menghapus volume/data**, sehingga bukan perintah penghentian rutin. PostgreSQL sebagai service sistem dikelola melalui pengelola service yang digunakan.

## Kamera dan model AI

### Kamera

Tambahkan/ubah kamera melalui halaman Kamera dengan izin `camera.write`. Isi RTSP sesuai kamera/NVR, misalnya `rtsp://USER:PASSWORD@IP-KAMERA:554/PATH`. Jangan commit kredensial kamera. API mendaftarkan konfigurasi pada worker AI; URL RTSP harus dapat dijangkau **dari host AI**, termasuk melalui LAN/VPN bila diperlukan.

ROI membatasi area analisis dan tersimpan di `storage/roi_config.json`; koordinat harus berada dalam batas frame. Kamera offline/frame kedaluwarsa tidak menghasilkan capture valid. Tinjau konfigurasi kamera default dalam kode API/AI saat memindahkan instalasi ke lingkungan lain.

### Model ONNX

Model tidak disertakan melalui Git. Letakkan model awal pada `models/active/model.onnx` dan sesuaikan `models/active/config.json`, atau unggah/aktifkan melalui aplikasi dengan izin `model.write`.

Contoh konfigurasi lengkap:

```json
{
  "name": "Tebu Segmentation V1",
  "version": "1.0.0",
  "type": "segmentation",
  "input_size": 640,
  "classes": ["daun", "pucuk", "sampah"],
  "threshold": 0.5,
  "output_activation": "probabilities",
  "input_color": "rgb",
  "model_path": "models/active/model.onnx"
}
```

Urutan kelas, ukuran input, warna (`rgb`/`bgr`), dan aktivasi output (`probabilities`/`sigmoid`/`softmax`) harus cocok dengan model. File `.onnx` harus berada dalam `models/`. Model yang dapat dibuka ONNX Runtime belum tentu memiliki output yang sesuai; format serta akurasi perlu diuji. Batas unggahan API: **200 MB**.

Model hilang mengembalikan kegagalan yang jelas, bukan grade acak. Health model tidak menggantikan uji inferensi nyata. Lihat [format AI](docs/ai-format.md) dan [kode service AI](apps/ai-service/main.py).

### Aturan grade backend

Total impuritas = `daun + pucuk + sampah`. [Rule engine](apps/api/src/rule-engine.ts) mengevaluasi X terlebih dahulu:

| Grade | Kondisi |
| --- | --- |
| X | Sampah > 15% **atau** total > 35% |
| G | Total > 20% sampai 35%, bila tidak memenuhi X |
| B | Total > 15% sampai 20%, bila tidak memenuhi X |
| D | Total > 10% sampai 15% |
| A | Total > 5% sampai 10% |
| M | Total > 2% sampai 5% |
| S | Total sampai 2% |

Ambang mutu harus sesuai SOP pabrik. Confidence model bukan jaminan akurasi produksi.

## Alur operasional dan impor tapping

Operator menjalankan inspeksi; admin/direksi meninjau mutu/persetujuan. Capture dan Start/Stop mengikuti role, permission, kamera, dan ketersediaan model.

Web/desktop menyediakan **Upload Excel Pabrik** untuk rekonsiliasi PT Trangkil. Parser menerima `.xlsx`, `.xls`, `.csv`, `.txt`, memilih sheet `DATA` atau sheet pertama, dan mencari header pada lima baris awal.

| Kolom contoh | Fungsi |
| --- | --- |
| `kd_antrian` | Identitas antrean; kolom utama parser |
| `no_meja` | Meja 1–5 untuk pencocokan otomatis |
| `mbs`, `kode` | Mutu pabrik |
| `tgl_nilai` | Waktu penilaian/tapping |
| `tgl_daftar` | Waktu daftar; acuan tanggal untuk sel berisi jam saja |
| `nopol` | Plat opsional, terpisah dari antrean |

Nama kolom memiliki beberapa alias; gunakan nama di atas untuk format jelas. Simpan nomor dengan nol awal sebagai teks. Tanggal tanpa zona diperlakukan sebagai waktu lokal; samakan zona workstation dengan data pabrik. Data tanpa meja/waktu valid tidak dicocokkan otomatis. Tinjau hasil dan koreksi manual sebelum menyimpan; pasangan tidak disimpulkan hanya dari urutan baris. Lihat [parser tapping](apps/web/src/utils/tapping.ts).

## Akun dan hak akses

| Role | Tanggung jawab |
| --- | --- |
| Developer | Mengelola platform, role, akun, kamera, model |
| Admin/direksi | Monitoring, evaluasi, pengelolaan yang diizinkan, persetujuan; capture operasional dibatasi eksplisit |
| Operator | Inspeksi dan monitoring sesuai izin/lingkup pabrik |
| Viewer | Monitoring dengan izin baca |
| Role kustom | Kombinasi permission dari pengelola berwenang |

Permission backend menjadi acuan; nama role bukan keseluruhan kebijakan. Developer dilindungi dan disembunyikan dari daftar non-developer. Lingkup pabrik saat ini memakai konvensi username/metadata kamera, bukan tabel tenant tersendiri. Pertahankan konvensi tersebut atau ubah kebijakan saat menambah pabrik.

Login awal memakai kredensial yang diisi pada `.env`, bukan asumsi `admin/admin`. Alur bernama “2FA” di UI saat ini memverifikasi password admin atau override PIN; belum berupa OTP/TOTP. Lihat [akses dan RBAC](docs/access-control.md).

## Database dan penyimpanan

Jalankan migrasi dengan `npm run db:migrate`:

| Migrasi | Fungsi |
| --- | --- |
| `001_initial.sql` | User, kamera, model, inferensi, inspeksi, relasi capture |
| `002_rbac.sql` | Role dan permission |
| `003_role_visibility.sql` | Perlindungan role developer |
| `004_active_truck_line.sql` | Pembatasan inspeksi aktif per jalur/kamera |
| `005_deletion_requests.sql` | Permintaan dan review penghapusan |

Database menyimpan metadata/relasi, sedangkan ONNX/snapshot/ROI berada di filesystem. Backup database saja tidak mencakup berkas tersebut. Volume Compose bernama `sugarcane_postgres` dapat memiliki prefix nama proyek. `database/migrations` merupakan referensi SQL Server lama, bukan migrasi aktif.

Contoh backup SQL database Compose lokal dari root:

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
docker exec sugarcane-postgres pg_dump -U sugarcane sugarcane |
  Set-Content -Encoding utf8 backups/sugarcane.sql
```

Periksa hasil/exit code dan uji restore pada database terpisah. Backup juga `models/`, snapshot yang diperlukan, dan `storage/roi_config.json` sesuai retensi. Jangan commit backup berisi data/secret ke repository publik. Lihat [database](docs/database.md).

## API dan komunikasi realtime

API bisnis memakai JSON dan bearer token, kecuali unggah model menggunakan multipart. WebSocket `/ws` mengirim event seperti `inference.created`, `truck.completed`, `model.activated`, dan perubahan permintaan penghapusan. Klien juga memakai polling.

| Endpoint utama | Kegunaan |
| --- | --- |
| `GET /health` | API hidup; bukan uji menyeluruh kamera/model |
| `POST /api/auth/login`, `GET /api/auth/me` | Login/sesi |
| `GET /api/system/status` | Status database/AI sesuai izin |
| `/api/cameras` | Pengelolaan kamera |
| `/api/cameras/:id/stream`, `/api/cameras/:id/snapshot` | Proxy media |
| `/api/cameras/:id/roi`, `/api/cameras/:id/capture` | ROI/inferensi |
| `/api/models`, `/api/models/upload`, `/api/models/activate` | Model |
| `/api/inference/latest`, `/api/inference/history` | Hasil inferensi |
| `/api/truck-inspections` | Inspeksi; subroute completion dan sync tapping |
| `/api/users`, `/api/roles` | Akses |
| `/api/deletion-requests` | Permintaan/review penghapusan |
| `GET /storage/snapshots/:filename` | Gambar capture |

Detail method/payload/izin tersedia pada [dokumentasi API](docs/api.md) dan [route API](apps/api/src/server.ts). Swagger otomatis tersedia untuk service AI di `/docs`; API Fastify belum menyediakan endpoint Swagger otomatis.

## Build dan pengemasan

### Workspace JavaScript

```powershell
npm run build
```

Urutan: contracts → API → web → desktop. Tidak membuat APK/iOS atau installer Electron.

| Hasil | Lokasi |
| --- | --- |
| Web statis | `apps/web/dist/` |
| API JavaScript | `apps/api/dist/` |
| Electron main/preload | `apps/desktop/dist/` |
| Paket Electron | `apps/desktop/release/` |

Preview web: `npm run preview -w @sugarcane/web`. API hasil build: `npm run start -w @sugarcane/api`. Layanan pendukung/config tetap diperlukan.

### Electron Windows

```powershell
npm run package -w @sugarcane/desktop -- --win
```

Untuk direktori aplikasi tanpa installer, setelah `npm run build`, jalankan dari `apps/desktop`:

```powershell
npx electron-builder --dir --win --x64
```

Executable: `apps/desktop/release/win-unpacked/TebuAI.exe`. Paket membawa renderer; API/AI/database tetap terpisah. Build Windows saat ini belum ditandatangani. Pilih alamat runtime sebelum membuka desktop:

```powershell
$env:SUGARCANE_API_URL = "https://api.example.com"
$env:SUGARCANE_AI_SERVICE_URL = "https://ai.example.com"
npm run dev:desktop
```

Gunakan alamat deployment Anda sebagai pengganti contoh. Lihat [desktop](docs/desktop.md).

### Flutter Android/iOS

Dari `apps/mobile`:

```powershell
flutter build apk --debug --dart-define=API_BASE_URL=http://192.168.1.10:4110
```

APK: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`. Android release memerlukan HTTPS dan signing milik Anda; konfigurasi saat ini masih memakai debug signing untuk release. iOS dibangun pada macOS dengan Xcode/signing, misalnya `flutter build ios` setelah konfigurasi siap.

## Pengujian dan pemeriksaan kualitas

Dari root, dengan dependensi terpasang dan `.venv` aktif untuk AI:

| Perintah | Pemeriksaan |
| --- | --- |
| `npm run typecheck` | TypeScript seluruh workspace |
| `npm test` | Parser/matching, header API, state frontend |
| `npm run test:integration` | API/PostgreSQL nyata pada schema sementara |
| `npm run test:ai` | Regresi model, ROI, snapshot, worker AI |
| `npm run build` | Build seluruh workspace JavaScript |
| `npm audit` | Kerentanan npm yang diketahui registry |

Integrasi membutuhkan `DATABASE_URL` dan user yang dapat membuat/menghapus schema uji. Fixture dibuat pada schema terisolasi; jangan arahkan tes ke produksi. Tes AI memakai keluaran sintetis, sehingga tidak membuktikan akurasi data lapangan.

Dari `apps/mobile`:

```powershell
flutter analyze
flutter test
```

[Verifikasi 8 Oktober 2026](docs/BUGFIX_VALIDATION.md) mencatat 21 tes frontend, 12 kasus regresi API, 11 tes AI, dan 4 tes Flutter lulus, serta typecheck/build/pengemasan desktop. Ini catatan pada waktu pemeriksaan, bukan jaminan perubahan berikutnya. Seluruh alur desktop langsung, mobile fisik, dan CCTV/model produksi masih perlu diuji.

## Troubleshooting

| Gejala | Langkah pemeriksaan |
| --- | --- |
| Vite gagal resolve `xlsx` | `npm install` dari root, periksa akses CDN SheetJS, restart Vite |
| Python `ModuleNotFoundError` | Aktifkan `.venv`, pasang paket `requirements.txt` |
| API gagal startup | Periksa PostgreSQL, `DATABASE_URL`, migrasi |
| `EADDRINUSE` / port terpakai | Hentikan instance lama; hindari layanan ganda |
| Login ditolak | Cek akun tersimpan/bootstrap; perubahan `.env` tidak mereset akun lama |
| Mobile tidak terhubung | IP LAN, bind `0.0.0.0`, firewall, jaringan; bukan `localhost` ponsel |
| Video offline, API online | Alamat AI dari klien, RTSP dari host AI, kredensial, LAN/VPN, worker |
| Model offline/capture gagal | ONNX, config, ONNX Runtime, frame kamera, format input/output |
| Capture dinonaktifkan | Role/permission dan model; admin tidak melakukan capture operasional |
| Renderer desktop tidak ditemukan | Build web/desktop dan jalankan ulang |
| UI desktop belum berubah | Rebuild/restart; desktop tidak memakai hot reload Vite |
| APK release gagal pada HTTP | Release mematikan cleartext; gunakan HTTPS valid |
| Warning chunk SheetJS ~500 kB | Build tetap berhasil; chunk impor terpisah, berbeda dari modul hilang |
| 401 / 403 | 401: sesi/login. 403: permission, role, lingkup pabrik |

Pemeriksaan tanpa kredensial:

```powershell
Invoke-RestMethod http://127.0.0.1:4110/health
Invoke-RestMethod http://127.0.0.1:8010/health
Get-NetTCPConnection -State Listen -LocalPort 4110,5175,8010,5432
```

Listener membantu menemukan layanan yang perlu dihentikan; jangan menghentikan semua proses Node/Python di komputer.

## Deployment

Compose repository **hanya menyiapkan PostgreSQL lokal**. Orkestrasi produksi penuh API/AI/web/backup/gateway belum disediakan; sesuaikan dengan infrastruktur pabrik.

Rancangan yang disarankan: frontend statis dan API/WebSocket/media di balik reverse proxy HTTPS; PostgreSQL/RTSP pada jaringan internal. Untuk memusatkan media, ubah jalur stream klien atau sediakan gateway yang cocok—kode saat ini masih memakai AI langsung.

Sebelum produksi, siapkan:

- Secret/password kuat, `NODE_ENV=production`, `DATABASE_REQUIRED=true`, dan kredensial database tersendiri.
- CORS terbatas: API saat ini memakai `origin: true`, AI mengizinkan origin umum; `WEB_ORIGIN` saja belum membatasi akses.
- Proteksi media: beberapa route stream/snapshot API tidak memeriksa bearer; AI belum mengautentikasi pengguna. Sediakan kontrol gateway/jaringan sebelum mengeksposnya.
- HTTPS/WSS, firewall, lingkup pabrik, peninjauan konvensi username/kamera.
- Storage bersama API/AI, backup/uji restore, retensi, kapasitas disk, supervisi/restart service.
- Signing Windows/Android/iOS; tinjau izin cleartext scaffold iOS dan endpoint mobile produksi.
- Validasi model, CCTV nyata, beban stream, serta inspeksi/persetujuan lintas perangkat.

Gunakan service manager/reverse proxy; mode watch/reload dan Vite development bukan deployment produksi. Lihat [deployment](docs/deployment.md).

## Panduan perubahan kode dan dokumentasi

Pasang paket npm dari root agar workspace/lockfile konsisten. Ubah aturan bisnis pada API, bukan hanya UI. Perubahan kontrak memerlukan pemeriksaan semua klien, termasuk representasi Dart pada Flutter. Tambahkan migrasi untuk perubahan schema dan tes regresi untuk perubahan logika berisiko.

| Dokumentasi | Isi |
| --- | --- |
| [Architecture](docs/architecture.md) | Rancangan batas service; cocokkan dengan implementasi aktual di README |
| [API](docs/api.md) | Endpoint |
| [Database](docs/database.md) | Struktur/pengelolaan |
| [Access control](docs/access-control.md) | Akun, role, permission |
| [AI format](docs/ai-format.md) | Konfigurasi model |
| [Desktop](docs/desktop.md) | Electron/pengemasan |
| [Mobile](apps/mobile/README.md) | Flutter/perangkat |
| [Deployment](docs/deployment.md) | Rancangan server |
| [Bugfix validation](docs/BUGFIX_VALIDATION.md) | Perbaikan/batas verifikasi |
| [Project analysis](docs/PROJECT_ANALYSIS.md), [execution plan](docs/EXECUTION_PLAN.md) | Analisis/rencana |

Dokumen rencana dapat memuat fitur yang belum diterapkan; manifest, migrasi, dan kode runtime menjadi acuan implementasi. Repository belum menyertakan file lisensi distribusi; tentukan ketentuan penggunaan/distribusi sebelum membagikannya sebagai proyek publik.
