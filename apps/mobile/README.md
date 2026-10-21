# Tebu AI Mobile (Flutter)

Klien Android/iOS untuk backend Fastify + PostgreSQL yang juga dipakai web dan Electron. Tidak ada data operasional dummy atau koneksi langsung ke database/AI service dari ponsel.

## Fitur

- Login, sesi tersimpan aman, logout, dan navigasi sesuai izin backend.
- Dashboard, status layanan, deteksi terbaru, riwayat/filter/bagikan CSV.
- Inspeksi truk lintas perangkat (mulai, selesaikan, hapus) tersimpan di PostgreSQL.
- Kamera RTSP (lihat/tambah/ubah/hapus), model AI (lihat/unggah ONNX/aktifkan).
- Pengguna (tambah/ubah/nonaktifkan) dan role kustom (developer); role Developer disembunyikan oleh API dari non-developer.
- Tema terang/gelap, alamat server yang bisa diubah, polling dan WebSocket untuk pembaruan.

## Menjalankan

Cara termudah untuk pengembangan seluruh platform dari akar repository adalah:

```powershell
npm run dev:all
```

Perintah tersebut memulai database, API, AI service, web, desktop, dan otomatis menjalankan Flutter ke Android apabila perangkat terdeteksi. Ponsel fisik harus tersambung USB dengan USB debugging aktif atau emulator harus sudah berjalan.

Mulai PostgreSQL, migrasi, dan backend dari akar repo lebih dulu (lihat README utama). Lalu:

```powershell
cd apps/mobile
flutter pub get
flutter run
```

Di mesin pengembangan ini Flutter SDK lokal juga tersedia di `.toolchains/flutter/bin/flutter.bat`, sehingga dapat memakai `..\..\.toolchains\flutter\bin\flutter.bat run` dari `apps/mobile` jika `flutter` belum ada di PATH.

Alamat default API: Android Emulator `http://10.0.2.2:4110`, iOS Simulator `http://127.0.0.1:4110`. Di ponsel fisik, ubah alamat di layar login/Pengaturan menjadi IP LAN atau domain server, misalnya `http://192.168.1.10:4110`. Backend harus mendengarkan alamat jaringan (`API_HOST=0.0.0.0`) dan firewall harus mengizinkan port 4110. Perangkat dan server harus berada pada jaringan yang saling terhubung. Alternatifnya set URL saat build: `flutter run --dart-define=API_BASE_URL=https://api.example.com`.

Untuk paket Android pengembangan: `flutter build apk --debug` → `build/app/outputs/flutter-apk/app-debug.apk`. Build iOS membutuhkan macOS, Xcode, sertifikat/signing, dan uji di perangkat/simulator iOS. Build release Android perlu keystore sendiri; template Flutter masih menggunakan debug signing untuk release.

HTTP/cleartext diizinkan pada build Android debug dan scaffold iOS untuk pengembangan lokal; build Android release mematikannya. Sebelum produksi, pakai HTTPS, hapus `NSAllowsArbitraryLoads` iOS, pasang certificate yang valid, serta ubah kredensial bootstrap/JWT secret di server. Jangan mengekspos PostgreSQL langsung ke ponsel.

## Struktur

- `lib/core.dart`: HTTP API, sesi aman, cache data, polling dan WebSocket.
- `lib/main.dart`: bootstrap, tema, dan navigasi adaptif.
- `lib/ui/common.dart`: komponen/tampilan bersama.
- `lib/features/{auth,dashboard,history,trucks,cameras,models,access,settings}/`: halaman dan aksi per domain.
- `android/`, `ios/`: project native hasil scaffold Flutter.

Perintah pemeriksaan: `flutter analyze`, `flutter build apk --debug`.
