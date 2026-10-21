# Audit kesiapan aplikasi — 21 Oktober 2026

Jalur inti web dan desktop telah diperbaiki dan diuji. Hasil ini mendukung uji penerimaan pengguna di instalasi Trangkil; kesiapan seluruh platform belum dapat dinyatakan selesai karena toolchain dan pengujian perangkat mobile belum tersedia.

## Hasil verifikasi

| Area | Verifikasi |
| --- | --- |
| Web/API/desktop | Build dan pemeriksaan TypeScript lulus, termasuk pemeriksaan kode lokal yang tidak dipakai. |
| Login dan akses | Login valid/tidak valid, sesi dinonaktifkan, pembatasan pabrik, larangan peningkatan hak akses, serta batas percobaan kredensial diuji pada database terpisah. |
| Pengguna dan role | Pembuatan role/user, larangan akun developer terakhir dinonaktifkan, dan pembatasan operator teruji. |
| Kamera/model | CRUD kamera, validasi URL, penghapusan kamera saat aktif ditolak, file model kosong ditolak, dan aktivasi gagal tidak mengganti model aktif. |
| Inspeksi | Start/Stop, pencegahan siklus ganda, penanganan layanan AI gagal, penolakan penghapusan siklus aktif, dan persetujuan penghapusan teruji. |
| Riwayat | Sinkronisasi capture, grade tersimpan, normalisasi, nomor frame per kamera, dan pembatasan akses media teruji. |
| Impor/ekspor | Parser CSV/Excel, tanggal Excel, pencocokan tapping, koreksi manual, dan ekspor CSV aman dari formula diuji. |
| UI nyata | Login, dashboard, History, Panduan Mutu, Users & Roles, cookie media, WebSocket, logout, dan navigasi layar sempit diuji di Electron/browser. |
| Installer Windows | `apps/desktop/release/TebuAI Setup 0.1.0.exe` berhasil dibuat (NSIS). |
| Desktop paket | `apps/desktop/release/win-unpacked/TebuAI.exe` dibuka langsung; UI, aset gambar, dan proxy backend bekerja. |
| AI unit | Konfirmasi full-frame, kamera beku, timer siklus, output tidak valid, sigmoid/softmax, batas ROI, lokasi model, serta autentikasi layanan diuji. |
| AI/CCTV nyata | Kamera Trangkil menghasilkan frame 1280×720. Model grading dan full-frame berhasil memberi keluaran valid. |
| Alur nyata terisolasi | Mulai manual → 6 capture → Stop → grade/snapshot tersimpan. Auto → konfirmasi full-frame → grading 30 detik → 30 capture → inspeksi selesai. Database dan snapshot audit dibersihkan. |
| Mobile | `flutter analyze` serta 4 tes komunikasi API, error jaringan, perpindahan server, dan validasi URL lulus. |
| Dependensi npm | Vite diperbarui ke 6.4.5. Audit npm melaporkan 0 kerentanan yang diketahui pada saat pemeriksaan. |

Pengujian dengan AI mock membuktikan kontrak dan penanganan kegagalan API. Pengujian CCTV nyata dijalankan secara terpisah dengan model asli; keduanya tidak memakai database operasional untuk data uji.

## Perbaikan penting

- WebSocket diproksikan saat pengembangan dan mencoba tersambung kembali setelah putus.
- Auto dan riwayat AI melewati backend `/api/ai`, sehingga browser publik tidak mencoba mengakses localhost penggunanya.
- Layanan AI memverifikasi token internal backend. Nilai default diturunkan dari `JWT_SECRET` yang harus sama pada kedua layanan; `AI_SERVICE_TOKEN` dapat dipakai sebagai override bersama.
- Notifikasi WebSocket hanya mengirim jenis perubahan, lalu klien mengambil data melalui endpoint yang membatasi pabrik.
- Desktop paket melayani UI melalui HTTP loopback internal agar gambar, cookie login, media dan WebSocket bekerja pada origin yang sama.
- Model unggahan di `models/archive` dapat ditemukan layanan AI; path keluar folder model tetap ditolak.
- Kamera bawaan instalasi baru memakai ID yang sama di API dan AI: 1 Kebon Agung, 2 Trangkil. Konfigurasi yang sudah ada tidak ditimpa.
- Grade T tetap merupakan hasil model T dan menunggu keputusan QC manual, sesuai keputusan pengguna. Sinkronisasi tapping memakai grade model tersimpan, bukan grade yang dihitung ulang dari persentase kotoran.
- Probabilitas kelas A/B/T tidak lagi diperlakukan sebagai persentase fisik daun/pucuk/sampah. Model klasifikasi menampilkan ?Tidak diukur?; hasil segmentasi dengan kelas fisik mempertahankan pengukurannya. Migrasi 006 menambah metadata tanpa menulis ulang nilai historis; data lama yang asal pengukurannya tidak diketahui ditandai tidak tersedia. Grade hasil inferensi langsung kini sesuai kelas dominan model, termasuk T dan X.
- Status koneksi tidak terus menampilkan Online saat pembaruan API gagal. Respons dari sesi/hak akses lama tidak diterapkan kembali.
- Perpindahan alamat server mobile menghapus sesi sebelumnya sebelum menghubungi server baru.

## Yang masih diperlukan sebelum distribusi penuh

1. **Android:** pembuatan APK belum terverifikasi karena Android SDK tidak ditemukan. Pasang/konfigurasikan SDK dan jalankan `flutter build apk`. Build release saat ini masih memakai signing debug dari template; ganti dengan keystore release sebelum distribusi produksi.
2. **iOS:** build, signing, dan pengujian iPhone memerlukan macOS/Xcode serta perangkat/akun yang sesuai; belum dijalankan pada Windows ini.
3. **Kebon Agung:** kamera 1 tidak terhubung saat pemeriksaan. Koneksi RTSP/VPN dan pengujian pabrik tersebut harus diselesaikan sebelum dipakai di sana. Bukti alur CCTV nyata audit ini berlaku untuk Trangkil.
4. **Penerimaan QC:** akurasi grading terhadap sampel berlabel, batas toleransi bisnis, dan kondisi lapangan perlu disetujui QC. Keberhasilan model menjalankan inferensi bukan pengukuran akurasi klasifikasi.
5. **Operasional produksi:** jalankan dengan secret yang benar, backup PostgreSQL yang dipulihkan secara berkala, HTTPS, serta pengawasan layanan. Paket desktop hasil audit belum ditandatangani dengan sertifikat distribusi.

Pemeriksaan lokal terakhir: `npm run check:ready` lulus **12/12**. Suite `npm test` lulus **18 tes**, AI **10 tes**, launcher desktop **3 tes**, dan Flutter **4 tes**; pengujian UI nyata juga lulus.

Metadata migrasi 006 sudah diterapkan pada database lokal. Keluaran AI dengan grade/format tidak valid ditolak sebelum disimpan.

## Pemeriksaan ulang

```powershell
npm run build
npm run typecheck
npm run check:ready
```

Berkas, skrip, folder, dan cache pengujian audit sudah dihapus sesuai permintaan pengguna. Hasil di atas merupakan catatan verifikasi sebelum pembersihan.

Untuk mobile, jalankan dari `apps/mobile`: `flutter analyze`. Ulangi build Android setelah SDK tersedia.

`npm run check:ready` hanya membaca konfigurasi, file model, koneksi database, layanan API/AI dan CCTV. Default kamera wajib adalah 2; gunakan `REQUIRED_CAMERA_IDS=1,2` jika kedua pabrik harus aktif. Gunakan `npm run check:ready -- --public` untuk turut memeriksa `NODE_ENV=production`.
