# Generator Berita Acara

Static web app untuk membuat draft Berita Acara Verifikasi dan generate PDF.

Berita Acara Generator dapat diakses dengan link:
https://generate-berita-acara.apps.ocpdevgra.dti.co.id/

Lingkungan kerja (Cloudflare Pages + Worker kolaborasi):
- Aplikasi: https://generate-berita-acara.pages.dev/
- Worker kolaborasi: https://generate-berita-acara-collab.alex-marcello08.workers.dev/health

Lebih detailnya ada pada file Panduan menggunakan Panduan menggunakan Berita Acara Generator.docx

## Kolaborasi Realtime

Tombol **Start Collab** membuat room baru, lalu **Copy Share Link** membagikan tautan `?doc=<id>`. Setiap field disimpan sebagai entri terpisah dengan cap waktu logis sendiri, sehingga dua orang yang menyunting bagian berbeda tidak saling menimpa. Bila dua orang menyunting field yang sama, nilai dengan cap waktu lebih baru yang menang, dan bila cap waktunya sama, urutan nama author dipakai agar kedua sisi selalu memilih pemenang yang sama.

Perubahan hanya dikirim untuk field yang benar-benar berubah, jadi tab yang lama tidak lagi menimpa pekerjaan orang lain. Field yang sedang diketik tetap dipertahankan beserta posisi kursor saat pembaruan dari pengguna lain masuk, dan soket yang mati terdeteksi lewat ping berkala sehingga status tidak terus menampilkan "Connected" secara keliru.

Perintah terkait:

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev:worker` | Menjalankan Worker kolaborasi secara lokal |
| `npm run deploy:worker` | Menerbitkan Worker kolaborasi |
| `npm run build:pages` | Menyusun bundel statis untuk Cloudflare Pages |
| `npm run deploy:pages` | Menerbitkan bundel statis ke `generate-berita-acara.pages.dev` |
| `npm run verify:collab` | Uji dua browser + satu Worker lokal |
| `COLLAB_E2E_TARGET=production npm run verify:collab` | Uji dua browser langsung ke situs produksi |

### Efisiensi Worker (suspend otomatis)

Room kolaborasi memakai WebSocket Hibernation API, sehingga saat tidak ada aktivitas Durable Object dikeluarkan dari memori dan tidak lagi ditagih durasinya walaupun koneksi tetap terbuka. Yang menjaga hal itu:

| Mekanisme | Perilaku |
| --- | --- |
| Hibernasi server | `acceptWebSocket` + tanpa timer sama sekali; setiap update ditulis ke storage sebelum diakui, jadi data tetap aman saat objek di-evict |
| Koalesensi klien | Ketikan digabung menjadi satu pesan per 300 ms, sehingga write ke storage ikut turun |
| Ping hemat | Ping hanya dikirim setelah satu interval penuh tanpa lalu lintas; room yang aktif tidak membangunkan Worker |
| Jeda klien | Kolaborasi dijeda setelah 5 menit idle atau 60 detik tab tidak aktif, lalu socket ditutup |

`npm test` memverifikasi kontrak hibernasi ini lewat `tests/workerHibernation.test.mjs`, termasuk memastikan tidak ada `setTimeout`/`setInterval` dan tidak ada peta sesi di memori.

## HTML Offline

`berita-acara-generator-offline.html` dapat dibuka langsung dari komputer tanpa internet. Seluruh JavaScript, ikon, dan jsPDF sudah tertanam; kolaborasi jaringan dinonaktifkan pada versi ini.

Jalankan `npm ci` lalu `npm run build:offline` untuk membangun ulang. Verifikasi dengan `npm test` dan `npm run verify:offline` (Chromium: `npx playwright install chromium`). Workflow **Build Offline HTML** membangun, menguji, dan memperbarui file HTML di GitHub pada setiap perubahan yang didorong ke `main`.

Untuk membuktikan salinan yang benar-benar diunduh dari GitHub tetap berjalan offline:

```bash
curl -sL -o /tmp/github-copy.html \
  https://raw.githubusercontent.com/UAT-A-BAS/generate-berita-acara/main/berita-acara-generator-offline.html
OFFLINE_ARTIFACT_PATH=/tmp/github-copy.html node scripts/verify-offline-artifact.mjs
```

Harness tersebut membuka berkas lewat `file://`, mengisi form, mengimpor draft, dan menekan Generate PDF, lalu memastikan tidak ada satu pun permintaan jaringan, WebSocket, atau error JavaScript.
