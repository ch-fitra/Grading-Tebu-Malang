# Hasil pemisahan instalasi Malang

Tanggal: 31 Oktober 2026. Proyek yang diedit: `D:\xoora\AI-Grading-Sugarcane-Malang`.

## Konfigurasi akhir

| Komponen | Malang | Trangkil dipertahankan |
|---|---|---|
| API | 127.0.0.1:4111 | 4110 |
| AI | 127.0.0.1:8011 | 8010 |
| UI pengembangan | 127.0.0.1:5176 | 5175 |
| Gateway | 127.0.0.1:8081 | 8080 |
| Web preview opsional | 127.0.0.1:5177 | Tidak diubah |
| PostgreSQL bersama | 127.0.0.1:5433 | Server yang sama |
| Database aplikasi | sugarcane_malang | sugarcane_trangkil |
| Database AI | sugarcane_ai_malang | sugarcane_ai_trangkil |
| Role DB Malang | sugarcane_malang, bukan superuser | Tidak diubah |
| Cookie | sugarcane_malang_session | sugarcane_session |
| Electron appId | id.xoora.tebuai.malang | Tidak diubah |
| Profil Electron | TebuAI-Malang | Tidak diubah |
| Android applicationId | com.valeamezamekaar.sugarcane_mobile.malang | Tidak diubah |
| iOS bundleId | com.valeamezamekaar.sugarcaneMobile.malang | Tidak diubah |

Kedua database Malang sudah dibuat dan dimigrasi. Akun awal Malang sudah di-bootstrap. Password, JWT secret dan service token acak disimpan pada `.env` lokal, tanpa ditampilkan dalam laporan. API dan AI menolak koneksi ke nama database lama. Cookie login/logout/media serta key browser/mobile dipisahkan.

## Kamera dan model

Kamera aplikasi ID **1**, station **2**: MBS 2 - PG Kebon Agung. RTSP diambil dari backup Malang. ID kamera berbeda dari nomor meja dan dijaga sama antara database aplikasi dan AI.

ROI awal: x=0.58, y=0.08, width=0.39, height=0.62, label PG Kebon Agung. Template terdapat di `apps/ai-service/models/malang_roi.json`; sinkronisasi mengisi ROI kosong khusus station 2 dengan ID aktual, tanpa menimpa kalibrasi. Database AI berprioritas lebih tinggi daripada file fallback.

Dua bobot Keras dipertahankan. Model grading menggunakan 11 kelas yang tercantum dalam konfigurasi Malang aktif. Model full-frame menghasilkan full_frame_sugarcane/not_full_frame. Uji eksekusi tidak menggantikan pengujian akurasi dengan gambar lapangan berlabel.

Malang memakai CPU dan dua thread Torch secara default untuk menghindari pemakaian GPU Trangkil. `.venv` lokal memakai PyTorch dasar server secara baca saja; dependensi lain berada di `.venv`. Tidak ada paket global yang di-upgrade. Versi dependency yang diperiksa dicatat pada `requirements-lock.txt`.

## Perubahan kode utama

- `.env`, `.env.example`, Docker opsional: pemisahan koneksi, port, secret, role dan database.
- `apps/api/src/env.ts`, Python `db/connection.py`: validasi identitas instalasi dan target database/layanan.
- API `auth.ts`, `store.ts`, `server.ts`, `migrate.ts`: akun Kebon Agung, bootstrap Meja 2/model yang benar, cookie Malang, factory kebonagung, health identity dan jalur absolut berdasarkan modul.
- Python `db/repository.py`, `main.py`, `streamer.py`: pemetaan ROI, identitas Malang, callback API Malang, resource CPU dan jalur snapshot.
- Web dashboard, riwayat, konfigurasi kamera, pengguna, detail, panduan, tapping dan station utility: identitas PG Kebon Agung/Malang, default Meja 2, penghapusan pemetaan salah 2 menjadi 5, referensi QC, dan filter/templat tapping Meja 2.
- Web API dan WebSocket: same-origin sebagai default, sehingga akses gateway/publik tidak mengarah ke localhost pengunjung.
- Web memakai badge teks PG Kebon Agung; tidak mengklaim badge sebagai logo resmi.
- Desktop dan mobile: alamat API Malang serta identitas instalasi/profil/penyimpanan masing-masing.
- `scripts/start-malang.ps1` dan `stop-malang.ps1`: validasi port, PID, command line, executable dan creation time; pelacakan interpreter anak Python; pemeriksaan idle sebelum stop. Tidak ada penghentian proses global berdasarkan nama.
- Gateway memiliki prefix, PID, konfigurasi dan log sendiri di `.runtime/malang`.
- Workflow Malang hanya validasi manual, tanpa deployment ke runner/path produksi Trangkil.
- README dan dokumentasi operasional diperbarui. Arsip `backup/malang` dipertahankan.

## Verifikasi yang sudah lolos

1. TypeScript typecheck API, web, desktop dan build ketiga workspace.
2. Flutter analyze: tidak ada masalah.
3. Integrasi API: koneksi database Trangkil ditolak sebelum startup; login/logout dan cookie Malang; cookie lama ditolak untuk media; origin Trangkil tidak mendapat izin CORS; kamera station 2; constraint station unik.
4. Proxy desktop: UI Malang dan API Malang melalui renderer server paket desktop.
5. Perlindungan proses: manifest dengan identitas salah ditolak, API yang diuji tetap hidup.
6. AI: migrasi database, ROI camera_id=1 untuk station 2, kalibrasi bertahan setelah sync/register, cache ROI dimuat ulang setelah kamera dinonaktifkan/diaktifkan, penolakan database Trangkil, pemuatan/inferensi kedua model.
7. Runtime Windows: start API/AI/Nginx, health installation=malang, UI/login/WebSocket melalui gateway, akses AI langsung tanpa token ditolak, stop dan pengecekan tidak ada layanan Malang tersisa.
8. Empat fixture pada port Trangkil 4110/8010/8080/5175 tetap berjalan dan tidak menerima request dari Malang selama uji runtime. Uji tidak menjalankan program Trangkil.
9. Nginx syntax, PowerShell syntax, Python compile, dependency check, dan git diff whitespace.
10. Hash 362 file proyek Trangkil dibandingkan baseline sebelum perubahan: **0 file berubah**. Bukti lokal: `.deploy/trangkil-verification.json`.

Uji runtime menonaktifkan kamera Malang sementara untuk menghindari koneksi RTSP, lalu memulihkan konfigurasi kamera. Setelah seluruh uji, layanan uji dihentikan. Malang siap dijalankan, tetapi tidak dibiarkan berjalan permanen oleh proses pengujian.

## Menjalankan sekarang

```powershell
Set-Location D:\xoora\AI-Grading-Sugarcane-Malang
npm run start:malang
```

Buka `http://127.0.0.1:8081`. Username operasional `admin_malang` atau `operator_malang`; password ada di `.env` lokal. Untuk berhenti, matikan Auto/selesaikan siklus lalu jalankan `npm run stop:malang`.

## Hal yang memerlukan data atau akses lapangan

- Keterjangkauan RTSP saat ini, framing kamera, dan kalibrasi ROI pada gambar aktual belum diverifikasi melalui kamera langsung.
- Akurasi grading dan parameter Auto (threshold 0.8, full/clear 3 detik, grading 30 detik) memerlukan validasi rekaman Malang.
- Arti kelas, rafaksi, keputusan giling dan contoh Excel Malang perlu dicocokkan dengan SOP QC; nilai referensi tidak ditebak atau diganti tanpa sumber.
- Domain publik telah ditetapkan: https://pgmalang.aisugarcanembs.com. Nginx dan PUBLIC_ORIGINS sudah disesuaikan. Route Cloudflare harus menuju HTTP 127.0.0.1:8081; aktivasi DNS/tunnel pada akun Cloudflare belum dilakukan dari sesi ini.
- Kapasitas server dengan dua beban kamera nyata perlu diukur. Tidak ada klaim throughput dari uji frame sintetis.

Salinan kode/konfigurasi sebelum perubahan ada di `.deploy/before-malang-*`. Tidak ada commit, push, publikasi, atau perubahan program Trangkil.

Pembaruan domain: pgmalang.aisugarcanembs.com. Atas instruksi pengguna, folder backup pada proyek Trangkil dihapus setelah lima file di dalamnya diverifikasi identik dengan backup Malang. Perubahan Trangkil pada tahap ini hanya penghapusan folder backup tersebut.

Verifikasi pembaruan domain: CORS origin publik dan cookie HTTPS Secure lolos. DNS domain menuju Cloudflare; pemeriksaan /health publik saat sesi ini menghasilkan HTTP 502, sehingga koneksi end-to-end publik belum terverifikasi. Backup Trangkil dipindahkan ke Windows Recycle Bin (dapat dipulihkan), bukan dihapus permanen. Lima salinan di Malang cocok dengan hash asli; tidak ada perubahan Trangkil lain terhadap baseline.

Pembaruan RTSP database-only: bootstrap RTSP dari environment dihapus; link kini dikelola melalui Konfigurasi Kamera dan tersimpan di database pabrik masing-masing. User camera.read dapat melihat link; CRUD memerlukan camera.write. Kamera lama dipertahankan. Detail: rtsp-database.md.
