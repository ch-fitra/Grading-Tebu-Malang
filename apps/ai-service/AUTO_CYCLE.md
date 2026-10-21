# Mode siklus otomatis

Aktifkan tombol **Aktifkan Auto** pada dashboard kamera. Tombol mulai/stop manual
menjadi abu-abu selama Auto aktif. Mematikan Auto mengakhiri dan menyimpan siklus
otomatis yang sedang berjalan, lalu membuka kontrol manual.

Alur per kamera:

1. Model `models/active/model_frame_sugarcane.keras` membaca **seluruh frame asli**,
   tanpa crop ROI dan tanpa overlay. Indeks 0 = `full_frame_sugarcane`, indeks 1 =
   `not_full_frame`.
2. Full frame harus terkonfirmasi terus-menerus selama **3 detik**. Prediksi tidak
   meyakinkan, kamera terputus, atau jeda frame lebih dari 1,5 detik mereset konfirmasi.
3. Siklus grading menggunakan model aktif yang sudah ada
   (`v0.0.1.sugarcane.keras` secara default), dengan pengaturan ROI grading sebelumnya.
   Akuisisi dijadwalkan sekali per detik selama **30 detik**. Slot yang tertinggal
   dilewati; jumlah frame dapat berkurang jika inferensi lambat atau kamera terputus.
   Tidak ada inferensi grading baru setelah deadline; penyimpanan frame yang sedang
   diproses dapat selesai sesudahnya.
4. Hasil disimpan ke `sugarcane_ai`; inspeksi dashboard di database utama memakai
   UUID siklus yang sama. Sinkronisasi capture backend yang sudah ada tetap digunakan.
5. Sistem menunggu `not_full_frame` yang meyakinkan selama **3 detik**, kemudian
   menerima konfirmasi full frame 3 detik untuk muatan berikutnya. Tebu yang masih
   memenuhi frame tidak membuat siklus berulang.

Model frame memakai RGB 224×224, nilai piksel 0–255 (normalisasi `Rescaling` sudah
tertanam di model), dan softmax pada dua output logits. Ambang keyakinan awal adalah
**80%**, diatur dalam `models/active/frame_config.json`. Ambang ini perlu divalidasi
dengan rekaman kamera lapangan; pengujian perangkat lunak bukan evaluasi akurasi model.
Model grading dan frame disimpan dalam cache terpisah.

## Pengoperasian

- Jalankan AI service, API, dan web seperti biasa. Restart AI service jika proses yang
  berjalan belum memuat kode baru, lalu muat ulang dashboard.
- Mode Auto tetap berjalan saat browser ditutup. Setelah AI service direstart, Auto
  kembali **mati**; inspeksi otomatis yang terputus diselesaikan saat startup.
- Jalankan **satu proses/worker AI service** untuk satu instalasi kamera. Pengendali
  dan kepemilikan siklus berada dalam memori proses tersebut.
- UI menggunakan `VITE_AI_SERVICE_URL` atau `sugarcaneDesktop.aiServiceUrl` yang sudah
  tersedia, default `http://127.0.0.1:8010`. Untuk akses dari komputer lain, URL tersebut
  harus dapat dijangkau browser (dan HTTPS jika dashboard memakai HTTPS).
- AI service memvalidasi token dan akses kamera melalui API lokal. Alamat default
  `http://127.0.0.1:4110`, mengikuti `API_PORT`/`BACKEND_PORT`; override menggunakan
  `AUTO_CYCLE_API_URL` jika API berada pada host lain. Admin direksi tetap tidak dapat
  mengubah kontrol siklus.
- Selesaikan siklus manual sebelum mengaktifkan Auto. Error database saat penyelesaian
  membuat pengendali mencoba menyelesaikan siklus yang sama; siklus baru tidak dimulai.

## Endpoint

`GET /cycle/auto/{camera_id}` membaca status; `PUT /cycle/auto/{camera_id}` dengan
`{"enabled": true}` atau `{"enabled": false}` mengubah mode. Keduanya memakai header
`Authorization: Bearer <token aplikasi>`. Timer dan monitoring berada di server.
