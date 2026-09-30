/**
 * =========================================================
 *  HABI API — Web Portal & Reverse Proxy
 *  Landing page + dokumentasi + proxy ke backend REST API.
 * =========================================================
 */

import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import * as downloader from './api/downloader.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'public')

const PORT = Number(process.env.PORT) || 8080
const HOST = process.env.HOST || '0.0.0.0'
const UPSTREAM = (process.env.UPSTREAM_API || 'http://140.245.32.37:3000').replace(/\/+$/, '')
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS) || 180000

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)

app.use(express.json({ limit: '1mb' }))

/* ---------------------------------------------------------
 * Konfigurasi situs — dikirim ke frontend via /config
 * ------------------------------------------------------- */
// URL publik yang dipakai di contoh kode & tombol tester.
// Kalau SITE_PUBLIC_URL di-set (mis. https://api.domain-kamu.com), itu yang dipakai.
// Kalau tidak, pakai origin dari request — otomatis benar di preview & di produksi.
function publicUrl(req) {
  if (process.env.SITE_PUBLIC_URL) return process.env.SITE_PUBLIC_URL.replace(/\/+$/, '')
  // Cloudflare/Nginx bisa mengirim beberapa header beruntun, ambil yang pertama
  const protoRaw = req.get('x-forwarded-proto') || req.protocol || 'http'
  const proto = String(protoRaw).split(',')[0].trim()
  return `${proto}://${req.get('host')}`
}

app.get('/config', (req, res) => {
  res.json({
    name: process.env.SITE_NAME || 'HABI API',
    tagline: process.env.SITE_TAGLINE || 'Downloader & Tools REST API',
    owner: process.env.OWNER_NAME || 'Habibih Cloud Official ID',
    wa: process.env.OWNER_WA || '6285181576338',
    website: process.env.OWNER_WEBSITE || 'https://habibi-store.pages.dev',
    support: process.env.SUPPORT_WA || process.env.OWNER_WA || '6285181576338',
    group: process.env.GROUP_LINK || '',
    quota: process.env.FREE_QUOTA_TEXT || '25 req/hari',
    baseUrl: publicUrl(req),
  })
})

/* ---------------------------------------------------------
 * Health check
 * ------------------------------------------------------- */
app.get('/healthz', (_req, res) => {
  res.json({ status: true, service: 'habi-api-web', uptime: Math.round(process.uptime()) })
})

/* ---------------------------------------------------------
 * Endpoint native — dijalankan langsung di web server
 * pakai yt-dlp, tidak lewat backend.
 * Semua tetap butuh apikey & ikut foramat JSON yang sama.
 * ------------------------------------------------------- */

/** Bungkus handler jadi route Express dengan timeout */
function native(pathname, handler) {
  app.get(pathname, async (req, res) => {
    const started = Date.now()
    try {
      const out = await handler(req, res)
      if (res.headersSent || out === undefined) return
      res.json(out)
      if (process.env.LOG_NATIVE === '1') {
        console.log(`  \x1b[36m⏱\x1b[0m  ${pathname} → ${Date.now() - started}ms`)
      }
    } catch (err) {
      console.error(`  \x1b[31m✗\x1b[0m  ${pathname}: ${err.message}`)
      res.status(400).json({ status: false, error: err.message })
    }
  })
}

/** Ambil & validasi parameter wajib */
function need(req, name) {
  const v = req.query[name]
  if (!v || !String(v).trim()) {
    throw new Error(`Parameter "${name}" wajib diisi.`)
  }
  return String(v).trim()
}

// Pencarian YouTube / YT Music
native('/api/ytsearch', (req) =>
  downloader.search(need(req, 'q'), {
    limit: req.query.limit,
    type: req.query.type === 'music' ? 'music' : 'video',
  })
)

// Metadata video (versi native, tidak lewat backend)
native('/api/ytinfo', async (req) => {
  const url = need(req, 'url')
  const info = await downloader.getInfo(url)
  return { status: true, ...info }
})

// Thumbnail YouTube (proxy supaya tidak kena hotlink)
native('/api/ytthumb', (req) => {
  const id = need(req, 'id')
  return {
    status: true,
    id,
    urls: {
      maxres: downloader.youtubeThumbnail(id, 'maxres'),
      sd: downloader.youtubeThumbnail(id, 'sddefault'),
      hq: downloader.youtubeThumbnail(id, 'hqdefault'),
    },
  }
})

// Spotify → cari di YouTube Music (Spotify DRM, jadi di-bypass)
native('/api/spotify', (req) => downloader.spotifyToYoutube(need(req, 'url')))

/* ---------------------------------------------------------
 * Proxy ke backend API
 * Semua /api/* lain diteruskan apa adanya (termasuk ?apikey=)
 * ------------------------------------------------------- */
app.all(/^\/api(\/.*)?$/i, async (req, res) => {
  const target = `${UPSTREAM}${req.originalUrl}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)

  // Header yang diteruskan (auth API lewat query string, bukan header)
  const headers = {}
  if (req.get('accept')) headers.accept = req.get('accept')
  if (req.get('user-agent')) headers['user-agent'] = req.get('user-agent')

  try {
    const method = req.method === 'HEAD' ? 'GET' : req.method
    const upstreamRes = await fetch(target, {
      method,
      headers,
      signal: controller.signal,
      redirect: 'follow',
    })

    const contentType = upstreamRes.headers.get('content-type') || ''

    // Teruskan file biner (mp3/mp4/png/zip) langsung sebagai stream
    if (!contentType.includes('application/json')) {
      res.setHeader('content-type', contentType)
      const length = upstreamRes.headers.get('content-length')
      if (length) res.setHeader('content-length', length)
      const disposition = upstreamRes.headers.get('content-disposition')
      if (disposition) res.setHeader('content-disposition', disposition)
      res.status(upstreamRes.status)
      if (!upstreamRes.body) return res.end()
      return Readable.fromWeb(upstreamRes.body).pipe(res)
    }

    const text = await upstreamRes.text()
    res.status(upstreamRes.status).type('application/json').send(text)
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({
        status: false,
        error: `Upstream timeout setelah ${Math.ceil(TIMEOUT / 1000)} detik.`,
      })
    }
    res.status(502).json({
      status: false,
      error: `Tidak bisa menghubungi backend API: ${err.message}`,
    })
  } finally {
    clearTimeout(timer)
  }
})

/* ---------------------------------------------------------
 * Halaman
 * ------------------------------------------------------- */
app.use(express.static(PUBLIC_DIR, {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  extensions: ['html'],
}))

app.get('/docs', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'docs.html')))
app.get('/pricing', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pricing.html')))
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')))

/* ---------------------------------------------------------
 * Error handler
 * ------------------------------------------------------- */
app.use((err, _req, res, _next) => {
  console.error('[HABI WEB ERROR]', err)
  res.status(500).json({ status: false, error: 'Internal server error' })
})

app.listen(PORT, HOST, () => {
  console.log(`\n  ▸ HABI API Web  →  http://${HOST}:${PORT}`)
  console.log(`  ▸ Upstream     →  ${UPSTREAM}\n`)
})
