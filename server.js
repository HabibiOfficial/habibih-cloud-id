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
import * as imageTools from './api/image-tools.mjs'

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
 * Image tools — semua digambar di server (self-hosted)
 * Mengembalikan file PNG/MP4 langsung.
 * ------------------------------------------------------- */

/** Kirim buffer gambar sebagai response */
function sendImage(res, buf, { ext = 'png', filename = null, download = false } = {}) {
  const mime = ext === 'mp4' ? 'video/mp4'
    : ext === 'webm' ? 'video/webm'
    : ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg'
    : 'image/png'
  res.setHeader('Content-Type', mime)
  if (filename) {
    const disposition = download ? 'attachment' : 'inline'
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename.replace(/[^\w.\-]/g, '_')}"`)
  }
  res.setHeader('Cache-Control', 'public, max-age=3600')
  return res.send(buf)
}

const BOOLS = (v, def = true) => {
  if (v === undefined) return def
  return !/^(0|false|no|off)$/i.test(String(v))
}

app.get('/api/brat', async (req, res) => {
  const started = Date.now()
  try {
    const buf = await imageTools.brat(need(req, 'text'), { blur: req.query.blur })
    sendImage(res, buf, { filename: 'brat.png', download: BOOLS(req.query.download, false) })
    if (process.env.LOG_NATIVE === '1') console.log(`  \x1b[36m⏱\x1b[0m  /api/brat → ${Date.now() - started}ms`)
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m  /api/brat: ${err.message}`)
    res.status(400).json({ status: false, error: err.message })
  }
})

app.get('/api/bratvid', async (req, res) => {
  const started = Date.now()
  try {
    const format = req.query.format === 'webm' ? 'webm' : 'mp4'
    const buf = await imageTools.bratVideo(need(req, 'text'), {
      format, fps: req.query.fps, width: req.query.width,
      height: req.query.height, duration: req.query.duration,
    })
    sendImage(res, buf, { ext: format, filename: `brat.${format}`, download: BOOLS(req.query.download, true) })
    if (process.env.LOG_NATIVE === '1') console.log(`  \x1b[36m⏱\x1b[0m  /api/bratvid → ${Date.now() - started}ms`)
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m  /api/bratvid: ${err.message}`)
    res.status(400).json({ status: false, error: err.message })
  }
})

app.get('/api/iqc', async (req, res) => {
  const started = Date.now()
  try {
    const batteries = req.query.batteries
      ? String(req.query.batteries).split(',').map((s) => s.trim())
      : [true, '87%']
    const buf = await imageTools.iphoneQuote({
      text: need(req, 'text'),
      time: req.query.time || '09.41',
      batteries,
      operator: BOOLS(req.query.operator, true),
      timebar: BOOLS(req.query.timebar, true),
      wifi: BOOLS(req.query.wifi, true),
      avatar: req.query.avatar || null,
    })
    sendImage(res, buf, { filename: 'iqc.png', download: BOOLS(req.query.download, false) })
    if (process.env.LOG_NATIVE === '1') console.log(`  \x1b[36m⏱\x1b[0m  /api/iqc → ${Date.now() - started}ms`)
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m  /api/iqc: ${err.message}`)
    res.status(400).json({ status: false, error: err.message })
  }
})

app.get('/api/meme', async (req, res) => {
  const started = Date.now()
  try {
    const buf = await imageTools.meme({
      image: req.query.image || req.query.url || null,
      top: req.query.top || '',
      bottom: req.query.bottom || '',
      author: req.query.author || '',
    })
    sendImage(res, buf, { filename: 'meme.png', download: BOOLS(req.query.download, false) })
    if (process.env.LOG_NATIVE === '1') console.log(`  \x1b[36m⏱\x1b[0m  /api/meme → ${Date.now() - started}ms`)
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m  /api/meme: ${err.message}`)
    res.status(400).json({ status: false, error: err.message })
  }
})

app.get('/api/watermark', async (req, res) => {
  const started = Date.now()
  try {
    const buf = await imageTools.watermark({
      image: need(req, 'image'),
      text: req.query.text || 'HABI API',
      position: req.query.position || 'br',
      opacity: req.query.opacity,
    })
    sendImage(res, buf, { filename: 'watermark.png', download: BOOLS(req.query.download, false) })
    if (process.env.LOG_NATIVE === '1') console.log(`  \x1b[36m⏱\x1b[0m  /api/watermark → ${Date.now() - started}ms`)
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m  /api/watermark: ${err.message}`)
    res.status(400).json({ status: false, error: err.message })
  }
})

// Humanizer mengembalikan JSON, bukan gambar
native('/api/humanizer', (req) =>
  imageTools.humanize(need(req, 'text'), {
    mode: req.query.mode === 'en' ? 'en' : 'indo',
  })
)

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
