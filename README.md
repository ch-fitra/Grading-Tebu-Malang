# TebuAI Malang - PG Kebon Agung

Instalasi satu pabrik pada `D:\xoora\AI-Grading-Sugarcane-Malang`, terpisah dari Trangkil pada server yang sama.

| Layanan | Trangkil (tetap) | Malang |
|---|---|---|
| API | 4110 | 4111 |
| AI | 8010 | 8011 |
| Web development | 5175 | 5176 |
| Gateway lokal | 8080 | 8081 |
| Database aplikasi | sugarcane_trangkil | sugarcane_malang |
| Database AI | sugarcane_ai_trangkil | sugarcane_ai_malang |
| Cookie | sugarcane_session | sugarcane_malang_session |

Port Malang di atas adalah port instalasi yang digunakan kode dan skrip. PostgreSQL yang sudah ada pada 5433 dipakai bersama dengan dua database serta login Malang tersendiri. File `.env` berisi konfigurasi dan password lokal, tidak boleh di-commit. Secret sesi dan komunikasi AI berbeda dari Trangkil. API dan AI menolak nama database lama.

## Persiapan komputer baru

1. Pasang Node.js 22+, Python 3.12, dan PostgreSQL. Salin kedua file model Keras dari instalasi lokal karena bobot tidak dilacak Git.
2. Jalankan `npm ci`. Salin `.env.example` menjadi `.env`, isi password/secret serta koneksi database Malang. Jangan menyalin `.env` Trangkil sebagai konfigurasi aktif.
3. Jalankan `py -3.12 -m venv .venv`, lalu `.\.venv\Scripts\python.exe -m pip install -r apps/ai-service/requirements-lock.txt`.
4. Dengan koneksi administrator PostgreSQL pada environment sementara `ADMIN_DATABASE_URL`, jalankan `npm run db:setup`. Skrip hanya membuat role `sugarcane_malang` dan database `sugarcane_malang`/`sugarcane_ai_malang`; tidak mengambil alih database yang sudah dimiliki role lain. Kredensial role disimpan ke `.env` lokal.
5. Jalankan `npm run db:migrate`, lalu `npm run build`.
6. Sediakan Nginx Windows pada `.runtime/nginx-1.30.6/` termasuk `conf/mime.types` (runtime lokal tersedia pada komputer saat ini).

Database AI dimigrasi oleh layanan AI saat startup. Instalasi kosong belum memiliki kamera. Untuk kamera Malang yang direferensikan backup, gunakan station **2**; ID database mengikuti hasil tambah/restore, bukan nomor meja. ID dan nomor meja tidak boleh disamakan. Tidak ada impor database dua pabrik otomatis.

## Menjalankan

```powershell
Set-Location D:\xoora\AI-Grading-Sugarcane-Malang
npm run start:malang
```

Buka `http://127.0.0.1:8081`. API pada `4111`, AI pada `8011`. Startup menolak port yang sudah dipakai, memeriksa identitas `installation=malang` pada health, dan tidak memakai ulang proses Trangkil. API, AI dan Nginx berjalan tersembunyi; log dan manifest berada di `.runtime/malang/`.

Untuk pengembangan, gunakan `npm run dev` (UI `5176`). Jangan menjalankan mode development dan production bersamaan untuk instalasi Malang karena keduanya memakai API/AI Malang yang sama. `npm run dev:desktop` menggunakan UI Malang `5176`; paket desktop memakai nama **TebuAI Malang** dan profil `TebuAI-Malang`.

## Menghentikan dan restart

Matikan Auto dan selesaikan siklus inspeksi dahulu, lalu jalankan `npm run stop:malang`. Skrip menolak stop saat ada siklus aktif atau identitas proses berbeda. Manifest menyimpan PID, executable, command line, dan waktu pembuatan proses. Nginx Malang memakai prefix/PID terpisah. Untuk restart, stop lalu start. Tidak ada perintah mematikan semua proses Node/Python/Nginx.

Jika listrik padam dan manifest tersisa, periksa setiap PID pada `.runtime/malang/processes.json` sebelum mengarsipkan manifest usang; jangan menghentikan proses berdasarkan nomor port saja.

## Kamera dan ROI

RTSP disimpan hanya pada kolom `cameras.rtsp_url` di database Malang. Tidak ada bootstrap kamera dari `.env`. Instalasi baru dimulai tanpa kamera; tambahkan melalui **Konfigurasi Kamera**, isi nama, nomor MBS, lokasi, link RTSP dan status aktif. Kamera Malang yang sudah ada tetap dipertahankan pada station 2.

Pengguna dengan izin `camera.read` dapat membuka **Lihat RTSP**; tambah/ubah/hapus memerlukan `camera.write`. Kamera dengan riwayat dinonaktifkan, bukan dihapus. Layanan AI menerima sinkronisasi dari database aplikasi; penghapusan kamera terakhir bertahan setelah restart.

ROI referensi terdapat pada `apps/ai-service/models/malang_roi.json`: x=0.58, y=0.08, width=0.39, height=0.62. Saat sinkronisasi, ROI hanya ditambahkan ke kamera station 2 yang belum memiliki ROI; camera_id mengikuti ID aktual. ROI yang sudah dikalibrasi tidak ditimpa. Database AI mendapat prioritas dibanding `storage/roi_config.json`, dan ROI dimuat dalam cache layanan.

Mode Auto memakai **frame utuh** untuk pemicu (threshold 0.8, konfirmasi 3 detik, clear 3 detik), sedangkan grading menggunakan ROI aktif selama maksimum 30 detik. Sudut kamera dan durasi proses Malang perlu diuji di lapangan. Bobot model dan ambang tidak diubah tanpa data validasi.

## Akun

Username operasional default adalah `admin_malang` dan `operator_malang`; password ada pada `.env` lokal bersama akun developer/direksi. Bootstrap tidak mengganti password user yang sudah ada. Jangan menyebarkan `.env`, backup database, atau token tunnel.

## Akses publik

Domain Malang adalah **https://pgmalang.aisugarcanembs.com**. Nginx dan `PUBLIC_ORIGINS` sudah disesuaikan. Pada Cloudflare Tunnel, arahkan hostname `pgmalang.aisugarcanembs.com` ke service **HTTP `127.0.0.1:8081`** pada server yang menjalankan Malang. Web, API, snapshot dan WebSocket menggunakan origin HTTPS yang sama. API/AI tidak perlu dipublikasikan langsung.

Route Cloudflare/DNS harus diatur pada akun pemilik domain; konfigurasi lokal tidak otomatis mengaktifkan route tersebut. Jika tunnel Trangkil dipakai bersama, tambahkan route Malang tanpa mengubah route Trangkil. File token tunnel/VPN warisan di `.runtime` tidak digunakan oleh skrip Malang.

## Verifikasi

- `npm run typecheck`: pemeriksaan TypeScript API, web dan desktop.
- `npm run build`: build ketiga workspace.
- `npm run check:ready`: koneksi database dan health API/AI/gateway Malang yang sedang berjalan.

## Batas validasi

Model grading Malang menggunakan 11 kelas sesuai konfigurasi model aktif: ATPSD, Akar Tanah, Daduk, Kocok Air, MBS, MBS Bintang, MBS Plus, Non MBS, Sogolan Pucuk, Tebu Muda, dan Terbakar. Skor classifier belum merupakan persentase kemiripan visual terkalibrasi. Format Excel Malang perlu dicocokkan dengan parser/template yang tersedia.

Backup `backup/malang` tetap utuh dan pasif. ZIP lama membawa dua pabrik dan pemetaan meja tidak konsisten, sehingga tidak dipulihkan menyeluruh. Backup perubahan lokal tersimpan di `.deploy/before-malang-*`. Deployment CI Malang hanya workflow manual validasi build, tidak menyasar runner atau direktori produksi Trangkil.

## Sumber daya AI lokal

Malang memakai CPU dan dua thread PyTorch secara default (`CUDA_VISIBLE_DEVICES=-1`, `AI_TORCH_THREADS=2`) agar tidak mengambil memori GPU Trangkil. Aktifkan GPU hanya setelah mengukur kapasitas kedua layanan bersama.

Lingkungan Python lokal menggunakan `.venv` dengan akses baca ke paket dasar Python 3.12 (`include-system-site-packages=true`) untuk memakai ulang PyTorch 2.6 yang sudah tersedia. Paket yang belum tersedia dipasang di `.venv` Malang; paket global tidak diperbarui. Instalasi bersih di komputer baru dapat memakai venv biasa dan `requirements-lock.txt` yang sama.

## Pemisahan demo dan produksi: konfigurasi kamera database

Demo satu server memakai database berbeda: Trangkil `sugarcane_trangkil`/`sugarcane_ai_trangkil`, Malang `sugarcane_malang`/`sugarcane_ai_malang`. RTSP tidak disimpan di `.env` aktif. `.env` tetap menyimpan koneksi database dan konfigurasi layanan, bukan link kamera.

Untuk server pabrik masing-masing, pindahkan **hanya** kedua database milik pabrik tersebut bersama model, ROI dan snapshot terkait, lalu sesuaikan host/port/akun database pada `.env` server tujuan. Kamera, link RTSP, nomor meja dan status ikut terbawa melalui backup/restore database. Alternatif instalasi kosong: tambahkan kamera melalui aplikasi. Jangan menyalin database pabrik lain. Akses jaringan kamera/VPN harus tersedia pada server pabrik tujuan.

CRUD kamera menyimpan perubahan ke database aplikasi dan meneruskannya ke layanan AI; jika AI sedang offline, status sinkronisasi pending akan dicoba ulang otomatis. Arsip backup lama bersifat pasif dan tidak menjadi sumber RTSP operasional.

## Perintah yang sama dengan Trangkil

`npm run start:malang` menjalankan layanan server (API, AI, gateway 8081) di background; tidak membuka desktop dan tidak menjalankan Flutter. Gunakan salah satu mode berikut, jangan bersamaan karena API/AI memakai port Malang yang sama.

| Perintah | Yang dijalankan |
|---|---|
| npm run dev / npm run dev:web | API 4111, AI 8011, web development 5176 |
| npm run dev:all | API 4111, AI 8011, web 5176, aplikasi desktop Malang |
| npm run dev:all -- -IncludeMobile | Semua pada dev:all ditambah Flutter pada Android terhubung/emulator aktif |
| npm run dev:desktop | Desktop dengan UI Vite Malang; API/AI harus sudah berjalan |
| npm run dev:dekstop | Alias ejaan lama untuk dev:desktop |
| npm run start:malang / stop:malang | Start/stop server background dan gateway 8081 |

Contoh Git Bash:

```bash
cd /d/xoora/AI-Grading-Sugarcane-Malang
npm run dev:all
# Atau, dengan Android terhubung/emulator aktif:
npm run dev:all -- -IncludeMobile
```

Hentikan sesi dev:all dengan **Ctrl+C di terminal yang menjalankannya**. Launcher menghentikan kelompok proses yang dibuatnya, bukan proses Trangkil atau PostgreSQL bersama. `stop:malang` digunakan untuk mode server background, bukan sesi dev:all.

Mobile memerlukan Flutter dan Android terdeteksi lewat USB debugging atau emulator yang sudah berjalan. Flag IncludeMobile tanpa perangkat akan berhenti dengan pesan yang jelas sebelum menjalankan layanan. Android emulator memakai API `http://10.0.2.2:4111`; ponsel fisik memakai IP LAN server pada port 4111 dan harus dapat menjangkaunya. Bila ponsel memiliki alamat server tersimpan, periksa alamat tersebut pada login/Pengaturan.

Untuk memilih perangkat atau alamat secara eksplisit:

```bash
npm run dev:all -- -IncludeMobile -MobileDeviceId ID_PERANGKAT -MobileApiUrl http://IP_SERVER:4111
```

Pemeriksaan tanpa menjalankan klien: `npm run dev:all -- -CheckOnly`. Tambahkan `-IncludeMobile` untuk memeriksa ketersediaan Android. Desktop memakai port 5176 dan profil Malang sendiri. Domain publik tetap memakai mode gateway/server pada 8081; dev:all mengikuti pola pengembangan Trangkil dan tidak menyalakan gateway/tunnel.
