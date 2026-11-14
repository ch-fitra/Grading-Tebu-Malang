# Mode siklus otomatis

Aktifkan tombol **Aktifkan Auto** pada dashboard kamera. Tombol mulai/stop manual
menjadi abu-abu selama Auto aktif. Mematikan Auto mengakhiri dan menyimpan siklus
otomatis yang sedang berjalan, lalu membuka kontrol manual.

Alur per kamera:

1. Model dipilih melalui `models/active/frame_config.json`: model aktif
   `model_frame_sugarcane.keras`, dengan `frame_input: embedded_roi`.
   Model menerima **frame asli penuh**, lalu layer `crop_table` memotong input
   224 x 224: atas 25, bawah 29, kiri 95, kanan 34. Area yang dibaca adalah
   meja, kira-kira x=42,4%-84,8%, y=11,2%-87,1% dari gambar penuh.
   Jangan melakukan crop ROI masuk sebelum inferensi model ini: crop internal
   akan diterapkan pada potongan yang salah. ROI masuk putih pada overlay
   bukan area pemicu model aktif ini. Model tanpa crop internal dapat memakai
   `frame_input: incoming_roi` untuk membaca ROI masuk dari aplikasi.
   Indeks 0 = `full_frame_sugarcane`, indeks 1 = `not_full_frame` mengikuti
   konfigurasi; urutan ini masih perlu dicocokkan dengan metadata pelatihan.
2. Area deteksi harus terkonfirmasi penuh tebu terus-menerus selama **3 detik**. Prediksi tidak
   meyakinkan, kamera terputus, atau jeda frame lebih dari 1,5 detik mereset konfirmasi.
3. Siklus grading menggunakan model aktif yang sudah ada
   (`model_sugarcane_malang.keras` secara default), dengan pengaturan ROI grading sebelumnya.
   Akuisisi dijadwalkan sekali per detik selama **50 detik**. Slot yang tertinggal
   dilewati; jumlah frame dapat berkurang jika inferensi lambat atau kamera terputus.
   Tidak ada inferensi grading baru setelah deadline; penyimpanan frame yang sedang
   diproses dapat selesai sesudahnya.
4. Hasil disimpan ke `sugarcane_ai`; inspeksi dashboard di database utama memakai
   UUID siklus yang sama. Sinkronisasi capture backend yang sudah ada tetap digunakan.
5. Sistem menunggu `not_full_frame` pada area deteksi yang sama selama **3 detik**,
   kemudian menerima konfirmasi penuh 3 detik untuk muatan berikutnya. Tebu yang
   masih memenuhi ROI masuk tidak membuat siklus berulang.

Model frame memakai RGB 224×224, nilai piksel 0–255 (normalisasi `Rescaling` sudah
tertanam di model), dan softmax pada dua output logits. Ambang keyakinan awal adalah
**80%**, diatur dalam `models/active/frame_config.json`. Ambang ini perlu divalidasi
dengan rekaman kamera lapangan; pengujian perangkat lunak bukan evaluasi akurasi model.
Model grading dan frame disimpan dalam cache terpisah.

Model aktif sudah berhasil dimuat dan diuji inferensi. Akurasi lapangan
belum diukur. Urutan kelas tetap mengikuti konfigurasi sebelumnya (indeks 0 penuh,
indeks 1 tidak penuh); cocokkan dengan urutan label saat pelatihan model baru.
Validasi dengan rekaman area kosong dan tebu masuk diperlukan untuk menilai ambang
80%. `not_full_frame` berarti
area tidak penuh, bukan jaminan area benar-benar kosong.

## ROI tebu masuk

Konfigurasi `incoming` disimpan bersama ROI grading melalui endpoint ROI yang sama.
Empat titik ternormalisasi, berurutan searah jarum jam dari kiri atas:
`(0.106, 0.052), (0.348, 0.052), (0.333, 0.407), (0.171, 0.407)`.
Sinkronisasi menambahkan area ini hanya untuk Meja Tebu 2 yang belum memiliki
field `incoming`, tanpa mengubah kalibrasi grading. `incoming: null` atau
`incoming.enabled: false` menonaktifkan crop aplikasi dan mengembalikan input full
frame untuk mode `incoming_roi`. Pada mode `embedded_roi`, area deteksi ditentukan
oleh layer model; mengubah titik overlay tidak mengubah crop internal model.
Klien lama yang menyimpan ROI tanpa field `incoming` mempertahankan area masuk.

Untuk memeriksa crop tanpa menjalankan grading, gunakan
`GET /api/cameras/{id}/snapshot?roi_target=incoming` melalui autentikasi aplikasi.
Endpoint mengembalikan 422 jika ROI masuk tidak tersedia atau dinonaktifkan.
Status Auto mengembalikan `detection_region` (`incoming`, `model_roi`, atau `full_frame`).
Jalankan `.venv\Scripts\python.exe scripts/test-incoming-roi.py` untuk pengujian
geometri, overlay, pemilihan crop dan pemicu siklus tanpa kamera.

## Pengoperasian

- Jalankan AI service, API, dan web seperti biasa. Restart AI service jika proses yang
  berjalan belum memuat kode baru, lalu muat ulang dashboard.
- Mode Auto tetap berjalan saat browser ditutup. Setelah AI service direstart, Auto
  kembali **mati**; inspeksi otomatis yang terputus diselesaikan saat startup.
- Jalankan **satu proses/worker AI service** untuk satu instalasi kamera. Pengendali
  dan kepemilikan siklus berada dalam memori proses tersebut.
- UI menggunakan `VITE_AI_SERVICE_URL` atau `sugarcaneDesktop.aiServiceUrl` yang sudah
  tersedia, default `http://127.0.0.1:8011`. Untuk akses dari komputer lain, URL tersebut
  harus dapat dijangkau browser (dan HTTPS jika dashboard memakai HTTPS).
- AI service memvalidasi token dan akses kamera melalui API lokal. Alamat default
  `http://127.0.0.1:4111`, mengikuti `API_PORT`/`BACKEND_PORT`; override menggunakan
  `AUTO_CYCLE_API_URL` jika API berada pada host lain. Admin direksi tetap tidak dapat
  mengubah kontrol siklus.
- Selesaikan siklus manual sebelum mengaktifkan Auto. Error database saat penyelesaian
  membuat pengendali mencoba menyelesaikan siklus yang sama; siklus baru tidak dimulai.

## Endpoint

`GET /cycle/auto/{camera_id}` membaca status; `PUT /cycle/auto/{camera_id}` dengan
`{"enabled": true}` atau `{"enabled": false}` mengubah mode. Keduanya memakai header
`Authorization: Bearer <token aplikasi>`. Timer dan monitoring berada di server.
