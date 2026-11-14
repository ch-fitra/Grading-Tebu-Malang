# Audit lokal insiden Malang, 14 November 2026

Audit ini membaca laporan pengguna dan source lokal. Tidak ada akses server, perubahan database, migrasi, startup layanan produksi, atau perubahan Trangkil.

## Kesimpulan berdasarkan bukti

HTTP 502 pada laporan berarti gateway tidak bisa menjangkau API. Penyebab API keluar setelah listener terbuka belum terbukti. Source tidak menunjukkan perintah process.exit yang menjelaskan kejadian tersebut sebelum perubahan ini. Kedua pool PostgreSQL sudah memiliki listener error; jangan menyimpulkan database mati pasti membuat API crash. Startup API tetap memerlukan database karena store.initialize dan auth.initialize berjalan sebelum listen.

Disk penuh dan PostgreSQL berhenti adalah fakta dalam laporan, bukan hasil pemeriksaan langsung audit lokal. Program dapat diperbaiki untuk menghadapi gangguan tersebut, tetapi perbaikan kode tidak membuktikan penyebab PostgreSQL berhenti atau menyelesaikan kapasitas disk.

## Kelemahan kode dan perbaikan awal

- Launcher mengimpor keras sebelum main.py menetapkan default torch. Sekarang default ditetapkan sebelum pemeriksaan; konfigurasi eksplisit tetap dihormati. Pemeriksaan Python dibatasi 120 detik dengan log terpisah.
- Manifest selalu menolak startup meskipun proses mati. Sekarang diarsipkan hanya setelah semua PID tercatat mati dan ketiga port kosong. PID hidup, termasuk PID yang digunakan ulang, tetap menolak startup.
- Dua startup dapat melewati pemeriksaan awal bersamaan. Sekarang file handle eksklusif mengunci seluruh startup.
- Readiness menelan error dan tidak memeriksa proses keluar. Sekarang ada fase startup, deadline readiness, PID dan exit code jika proses keluar lebih awal.
- Kegagalan cleanup dapat menutupi error startup. Sekarang error asli dipertahankan; cleanup yang ditolak tetap dilaporkan dan manifest disimpan.
- Pemeriksaan idle hanya membatasi koneksi, belum query. Sekarang query dan statement dibatasi 10 detik.
- API belum mencatat exit dan signal. Sekarang exit/fatal event dicatat dan SIGINT/SIGTERM menutup kedua pool dengan deadline 15 detik. Stop-Process Windows atau penghentian paksa tetap tidak menjamin handler Node berjalan.

## Pekerjaan tersisa sebelum menyatakan siap produksi

1. Recovery AI hanya mencari truck_inspections active dengan notes AUTO_FRAME. ai_results running tanpa pasangan tidak tercakup. Perlu status interupsi dan audit trail yang kompatibel dengan schema, endpoint, dan laporan; jangan otomatis menandainya completed sebagai bukti sukses.
2. Cleanup launcher tetap menolak berhenti jika database tidak dapat diperiksa atau grading aktif. Ini perlindungan yang disengaja; jalur recovery dengan bukti kepemilikan worker masih perlu dibuat dan diuji.
3. Belum ada supervisor/restart policy. Ini bukan jaminan API akan pulih otomatis setelah proses mati.
4. Uji integrasi dengan database disposable: putus-sambung database, siklus terputus, launcher Python Windows dengan child interpreter, startup sebagian, shutdown Nginx, dan hasil grading kosong. Jangan memakai test-runtime.mjs pada produksi: script itu mengubah enabled kamera dan menjalankan layanan.
5. Korelasikan log runtime/exit dan log PostgreSQL ketika nanti diuji di server untuk membuktikan penyebab historis.

## Validasi lokal

TypeScript API, parser PowerShell, node --check pemeriksaan idle, git diff --check, serta test-launcher-safety.ps1. Tes launcher memakai direktori sementara dan memeriksa penolakan startup bersamaan serta perlindungan manifest PID hidup; tidak membuka database. Belum menguji model, kamera, login, atau recovery database end-to-end.
