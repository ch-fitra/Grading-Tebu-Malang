# Perbaikan dan verifikasi bug — 8 Oktober 2026

Error Vite `Failed to resolve import "xlsx"` telah diperbaiki. SheetJS memakai distribusi resmi 0.20.3 sesuai [panduan instalasi SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), lockfile diperbarui, dan `dev:all` memulihkan dependensi sebelum menjalankan aplikasi. Parser spreadsheet dimuat saat dibutuhkan agar tidak memperbesar bundle awal.

## Bug lain yang diperbaiki

- **Impor dan rekonsiliasi tapping:** tanggal Excel/CSV, epoch 1904, waktu tanpa tanggal, nomor dengan nol di depan, pemisahan antrean dan plat, baris pertama tanpa header, validasi meja, batas waktu pencocokan, penugasan ganda, dan pertukaran baris pada hasil yang difilter. Penugasan manual tidak hilang ketika polling. Kegagalan sinkronisasi backend tidak lagi mengubah data lokal.
- **Frontend:** header otorisasi tidak tertimpa header tambahan; polling lama tidak dapat menimpa respons baru atau mengisi data setelah logout; gangguan jaringan sementara tidak menghapus riwayat; akses halaman mengikuti izin; filter History mengikuti kamera yang dapat diakses termasuk Kebon Agung; pencarian frame bekerja; klik sidebar tidak bergeser ketika hover; logo memakai path yang cocok untuk Electron.
- **Users & Roles:** akun bootstrap admin tidak disembunyikan; error pemuatan ditampilkan; daftar kosong dibedakan dari proses pemuatan.
- **API dan PostgreSQL:** kegagalan database tidak menghasilkan keberhasilan atau data operasional palsu dalam memori. Penyelesaian inspeksi, sinkronisasi tapping, dan persetujuan penghapusan memakai transaksi. Permintaan penghapusan tersimpan di PostgreSQL. ID dan batch divalidasi; konflik inspeksi aktif mengembalikan 409; batas akses pabrik diterapkan pada perubahan dan penghapusan; query string tidak dapat melewati autentikasi; izin ROI dan pembatasan pemberian hak akses diperbaiki. Verifikasi admin membaca password database terkini.
- **AI dan CCTV:** model hilang mengembalikan kegagalan yang jelas, bukan grade acak. Confidence tidak direkayasa. Keluaran segmentasi dihitung dari seluruh piksel, bentuk dan nilainya divalidasi, session model dicache, dan aktivasi model yang gagal menjaga konfigurasi sebelumnya. Timestamp memakai zona waktu UTC dan nama snapshot unik. Frame lama/offline tidak dilaporkan sebagai live; snapshot bekerja tanpa pelanggan stream; batas ROI dan parameter stream divalidasi; worker kamera mengikuti lifecycle service.
- **Pemindaian otomatis:** permintaan capture tidak tumpang tindih, callback berhenti ketika halaman ditutup, dan akun tanpa izin tidak menjalankan pemindaian. Auto Stop hanya diaktifkan bila service menyediakan deteksi conveyor kosong; impuritas nol tidak disamakan dengan conveyor kosong.
- **Flutter dan startup:** respons lama tidak menghidupkan kembali sesi setelah logout; timeout mencakup pengiriman request; reconnect WebSocket dibersihkan saat dispose. Flutter opsional untuk startup desktop/web; deteksi platform Android dan alamat LAN diperbaiki.
- **Dependensi:** audit npm awal menemukan 14 kerentanan. Pembaruan dependensi dan penempatan electron-builder pada root workspace membuat override global-agent berlaku. Audit akhir menemukan 0 kerentanan yang diketahui npm.

## Hasil pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run typecheck` | Lulus seluruh workspace |
| `npm test` | 21 tes lulus |
| `npm run test:integration` | 12 kasus regresi API lulus, 13 hasil termasuk tes induk |
| `.venv/Scripts/python.exe -m unittest discover -s tests -p test_ai.py -v` | 11 tes AI lulus |
| Flutter `analyze` | Tidak ada masalah |
| Flutter `test` | 4 tes lulus |
| `npm run build` | Lulus contracts, API, web, desktop |
| `npx electron-builder --dir --win --x64` dari `apps/desktop` | Paket Windows berhasil dibuat |
| `npm audit` | 0 kerentanan |
| `git diff --check` | Lulus |
| Pemeriksaan Chrome pada `localhost:5175` | Dashboard, History, modal tapping, dan Users & Roles terbuka tanpa overlay error Vite; admin muncul; pemeriksaan konsol terakhir tidak mencatat error |

Tes integrasi membuat schema PostgreSQL sementara dengan akun dan data uji, kemudian menghapus schema tersebut. Data operasional pengguna tidak digunakan sebagai fixture. Migrasi `005_deletion_requests.sql` telah diterapkan pada database lokal.

Perbaikan diperiksa bertahap, kemudian tes terkait dan build diulang setelah temuan terakhir pada History dan Users & Roles. Bukti tampilan: [Users & Roles](bugfix-users-verified.jpg).

## Batas verifikasi

Model ONNX operasional belum tersedia dan kamera yang diperiksa offline. Karena itu, akurasi model dengan data nyata, stream CCTV langsung, dan siklus produksi penuh belum dapat dipastikan. Tes AI menggunakan keluaran sintetis untuk memeriksa logika, validasi, dan penanganan kegagalan. Pengemasan Electron telah diuji; interaksi lengkap aplikasi desktop dan perangkat Android fisik belum diuji.

Build Vite masih memberi peringatan ukuran chunk SheetJS sekitar 500 kB. Build berhasil, dan chunk tersebut dimuat terpisah saat impor spreadsheet. Ini merupakan catatan ukuran bundle, bukan kegagalan resolusi modul.

Hasil di atas menunjukkan bug yang ditemukan dalam pemeriksaan ini telah ditangani; tidak merupakan jaminan bahwa seluruh kemungkinan bug telah dieliminasi.
