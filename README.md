# =========================================================
#  Habibih Cloud ID — HABI API
#  Website + dokumentasi + reverse proxy untuk REST API.
# =========================================================

<div align="center">

# 🌐 HABI API

**REST API Downloader & Tools — Habibih Cloud ID**

[![Node](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)

Landing page + dokumentasi interaktif + reverse proxy ke backend REST API.

</div>

---

## ✨ Fitur

| | Fitur |
|---|---|
| 🎨 | **Landing page modern** — dark theme, gradient, animasi halus |
| 📖 | **Dokumentasi lengkap** — 19 endpoint, parameter, contoh respons |
| 💰 | **Halaman harga** — 3 paket + tabel perbandingan |
| 🧪 | **Playground** — tester endpoint langsung dari browser |
| 🔑 | **Registrasi API key** — form built-in, key tersimpan lokal |
| 🔁 | **Reverse proxy** — meneruskan `/api/*` ke backend |
| 📦 | **Stream biner** — mp3/mp4/png dikirim langsung, bukan di-buffer |
| 🩺 | **Health check** — `GET /healthz` untuk monitoring |
| ⚙️ | **Config dinamis** — contoh kode ikut domain yang sedang dibuka |

---

## 📂 Struktur

```
habi-api-web/
├── server.js              # Express + reverse proxy
├── package.json
├── .env.example           # Contoh konfigurasi
├── public/
│   ├── index.html         # Landing page
│   ├── docs.html          # Dokumentasi API
│   ├── pricing.html       # Halaman harga
│   └── assets/
│       ├── style.css      # Shared stylesheet
│       └── app.js         # Frontend helpers
├── deploy/
│   ├── nginx.conf         # Konfigurasi reverse proxy Nginx
│   └── cloudflared-*.yml  # Konfigurasi Cloudflare Tunnel
└── scripts/
    ├── setup-vps.sh       # Setup awal VPS Ubuntu
    └── deploy.sh          # Deploy/update aplikasi
```

---

## 🚀 Menjalankan secara Lokal

```bash
# 1. Install dependency
npm install

# 2. Salin konfigurasi
cp .env.example .env

# 3. Edit .env — minimal isi UPSTREAM_API
nano .env

# 4. Jalankan
npm start
```

Buka `http://localhost:8080`.

---

## ⚙️ Konfigurasi

Semua diatur lewat environment variable (lihat `.env.example`):

| Variable | Default | Keterangan |
|---|---|---|
| `PORT` | `8080` | Port web server |
| `HOST` | `0.0.0.0` | Host yang di-bind |
| `UPSTREAM_API` | `http://140.245.32.37:3000` | Alamat backend API |
| `UPSTREAM_TIMEOUT_MS` | `180000` | Timeout upstream (ms) |
| `SITE_PUBLIC_URL` | *(kosong)* | Domain publik, mis `https://api.domain.com` |
| `SITE_NAME` | `HABI API` | Nama yang tampil di halaman |
| `SITE_TAGLINE` | `Downloader & Tools REST API` | Tagline |
| `OWNER_NAME` | `Habibih Cloud Official ID` | Nama owner |
| `OWNER_WA` | `6285181576338` | Nomor WhatsApp (format internasional) |
| `SUPPORT_WA` | `6285181576338` | Nomor WhatsApp untuk support |
| `OWNER_WEBSITE` | `https://habibi-store.pages.dev` | Website owner |
| `GROUP_LINK` | — | Link grup WhatsApp |
| `FREE_QUOTA_TEXT` | `25 req/hari` | Teks kuota yang diumumkan |

> Kalau `SITE_PUBLIC_URL` kosong, domain diambil otomatis dari request — jadi otomatis benar di preview maupun produksi.

---

## 🔌 Endpoint Web

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/` | Landing page |
| `GET` | `/docs` | Dokumentasi API |
| `GET` | `/pricing` | Halaman harga |
| `GET` | `/config` | Konfigurasi runtime (JSON) |
| `GET` | `/healthz` | Health check |
| `*` | `/api/*` | Proxy ke backend API |

---

## 🚢 Deploy ke VPS

```bash
# Setup awal (sekali saja)
sudo bash scripts/setup-vps.sh

# Deploy / update
bash scripts/deploy.sh
```

Deploy otomatis pakai **PM2** agar proses tetap jalan setelah server restart.

---

## 🔐 Keamanan

- `.env` dan `node_modules` **tidak** masuk repository (lihat `.gitignore`)
- Semua kredensial disimpan sebagai **GitHub Secrets**, bukan di kode
- Deployment lewat **GitHub Actions** dengan SSH key, bukan password

---

## 📄 Lisensi

MIT © Habibih Cloud Official ID

---

<div align="center">

**Made with ☕ by Habibih Cloud Official ID**

[Website](https://habibi-store.pages.dev) · [WhatsApp](https://wa.me/6285181576338)

</div>
