# Model grading Malang

Model aktif: `model_sugarcane_malang.keras`. Input RGB 224 × 224 dengan piksel
0–255. Model sudah memiliki layer rescaling; output berupa 11 logits yang
diproses dengan softmax oleh layanan AI.

| Indeks | Kelas |
|---|---|
| 0 | ATPSD |
| 1 | Akar Tanah |
| 2 | Daduk |
| 3 | Kocok Air |
| 4 | MBS |
| 5 | MBS Bintang |
| 6 | MBS Plus |
| 7 | Non MBS |
| 8 | Sogolan Pucuk |
| 9 | Tebu Muda |
| 10 | Terbakar |

Nama kelas disimpan langsung, tanpa konversi ke kode kelas Trangkil.
Endpoint inferensi juga mengembalikan `detected_class_index` (berbasis nol).
Probabilitas kelas bukan persentase kotoran fisik. Rafaksi ditentukan QC.

ROI Meja 2: x=0.49, y=0.14, width=0.32, height=0.72, relatif terhadap
frame CCTV penuh. Ini perkiraan persegi panjang dari garis ungu yang diberikan
pengguna; periksa penempatannya pada stream CCTV sebelum menilai akurasi.
Sinkronisasi kamera mengganti ROI default sebelumnya dan mempertahankan
kalibrasi operator yang berbeda. ROI tersimpan di database AI khusus Malang.

Jalankan `npm run test:ai` untuk memeriksa seluruh indeks, eksekusi model asli,
penyimpanan label panjang, dan pemetaan ROI ke ID kamera Meja 2.
