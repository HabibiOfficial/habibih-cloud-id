/**
 * =========================================================
 *  Downloader — modul yt-dlp native (self-hosted)
 *
 *  Semua fitur di file ini menjalankan yt-dlp sendiri di
 *  server kita. Tidak bergantung pada API pihak ketiga.
 * =========================================================
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/* ---------------------------------------------------------
 * Path yt-dlp
 * Cari dari beberapa lokasi supaya tetap jalan walau env
 * tidak ikut ter-deploy (mis. saat auto-deploy menimpa file).
 * ------------------------------------------------------- */
function resolveYtDlp() {
  const fs = require('node:fs')
  const candidates = []

  // 1) override dari environment
  if (process.env.YTDLP_PATH) candidates.push(process.env.YTDLP_PATH)
  // 2) folder bin di dalam project
  candidates.push(path.join(process.cwd(), 'bin', 'yt-dlp'))
  candidates.push(path.join(__dirname, '..', 'bin', 'yt-dlp'))
  // 3) lokasi umum di server
  candidates.push('/home/deploy/bin/yt-dlp')
  candidates.push('/usr/local/bin/yt-dlp')
  candidates.push('/usr/bin/yt-dlp')

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c
    } catch { /* lanjut ke kandidat berikutnya */ }
  }
  return 'yt-dlp'
}

const BIN = resolveYtDlp()
const DEFAULT_TIMEOUT = Number(process.env.YTDLP_TIMEOUT_MS) || 120000

/* ---------------------------------------------------------
 * Jalankan yt-dlp, ambil stdout
 * ------------------------------------------------------- */
export function runYtDlp(args, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let proc
    try {
      proc = spawn(BIN, args, { windowsHide: true })
    } catch (err) {
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`))
      return
    }

    let stdout = ''
    let stderr = ''
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      proc.kill('SIGKILL')
    }, timeoutMs)

    proc.stdout.on('data', (c) => { stdout += c.toString() })
    proc.stderr.on('data', (c) => { stderr += c.toString() })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(
        err.code === 'ENOENT'
          ? new Error('yt-dlp tidak terpasang di server.')
          : new Error(err.message)
      )
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (killed) return reject(new Error('yt-dlp timeout.'))
      if (code === 0) return resolve({ stdout, stderr })
      reject(new Error(cleanError(stderr || stdout)))
    })
  })
}

/** Ambil pesan error yang enak dibaca user (buang noise yt-dlp) */
function cleanError(raw) {
  const lines = String(raw).split('\n').map((l) => l.trim()).filter(Boolean)
  const picked = lines
    .filter((l) => /^ERROR|^WARNING|^error/i.test(l) || l.includes('Video unavailable') || l.includes('Private'))
  const msg = (picked[0] || lines[lines.length - 1] || 'yt-dlp gagal')
  return msg.replace(/^ERROR:\s*/i, '').slice(0, 300)
}

/* ---------------------------------------------------------
 * Ambil metadata satu video (JSON)
 * ------------------------------------------------------- */
export async function getInfo(url) {
  const { stdout } = await runYtDlp([
    url,
    '-j',
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
  ], 45000)

  const first = stdout.trim().split('\n').filter(Boolean)[0]
  if (!first) throw new Error('Metadata tidak ditemukan.')

  let d
  try {
    d = JSON.parse(first)
  } catch {
    throw new Error('Gagal membaca metadata.')
  }

  return {
    id: d.id,
    title: d.title || d.fulltitle || 'Tanpa judul',
    duration: d.duration ?? null,
    uploader: d.uploader || d.channel || null,
    thumbnail: d.thumbnail || null,
    webpage_url: d.webpage_url || url,
    view_count: d.view_count ?? null,
    ext: d.ext || null,
    is_live: Boolean(d.is_live),
  }
}

/* ---------------------------------------------------------
 * Pencarian YouTube / YouTube Music
 * ------------------------------------------------------- */
/**
 * @param {string} query  kata kunci
 * @param {object} opts   { limit, type: 'video'|'music' }
 */
export async function search(query, { limit = 10, type = 'video' } = {}) {
  const n = Math.min(Math.max(Number(limit) || 10, 1), 25)
  // ytsearch = video,  prefix "ytmsearch" tidak resmi → pakai filter agar audio
  const target = `ytsearch${n}:${query}`

  const { stdout } = await runYtDlp([
    target,
    '--flat-playlist',
    '--print',
    '%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(channel)s\t%(url)s',
    '--no-warnings',
  ], 60000)

  const items = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, title, duration, uploader, channel, url] = line.split('\t')
      if (!id) return null
      return {
        id,
        title: title || 'Tanpa judul',
        duration: duration && duration !== 'NA' ? Number(duration) : null,
        uploader: uploader || channel || null,
        url: url || `https://www.youtube.com/watch?v=${id}`,
      }
    })
    .filter(Boolean)

  return { query, count: items.length, type, results: items }
}

/* ---------------------------------------------------------
 * Spotify → YouTube Music
 *
 * Spotify memakai DRM sehingga yt-dlp tidak bisa menarik
 * audio langsung. Solusinya: ambil judul + artis dari
 * oEmbed resmi Spotify (endpoint publik & stabil), lalu
 * cari yang sama di YouTube Music. Hasil tetap audio
 * original dari YouTube.
 * ------------------------------------------------------- */
export async function spotifyToYoutube(spotifyUrl) {
  let url
  try {
    url = new URL(spotifyUrl)
  } catch {
    throw new Error('URL Spotify tidak valid.')
  }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname.replace(/^www\./, ''))) {
    throw new Error('Link tersebut bukan link Spotify.')
  }

  const meta = await spotifyMeta(url.href)

  // Cari di YouTube — judul + artis supaya lebih spesifik
  const found = await search(`${meta.title} ${meta.artist} audio`, { limit: 8 })
  if (!found.results.length) {
    throw new Error(`Lagu "${meta.title}" tidak ditemukan di YouTube.`)
  }

  // Pilih kandidat terbaik:
  //  1. judul memuat judul lagu
  //  2. nama channel memuat nama artis
  //  3. buang hasil yang jelas bukan lagu asli (cover, translate, live, reaction)
  const target = meta.title.toLowerCase()
  const artistL = meta.artist.toLowerCase()
  const BAD = /\b(cover|translate|reaction|commentary|sped up|nightcore|remix|instrumental|lyrics?|live|concert)\b/i

  const scored = found.results
    .map((r) => {
      const t = r.title.toLowerCase()
      const up = (r.uploader || '').toLowerCase()
      let score = 0
      if (t.includes(target)) score += 50
      if (artistL && artistL !== 'unknown' && (t.includes(artistL) || up.includes(artistL))) score += 30
      if (/\bofficial\b|\bvevo\b|\baudio\b/i.test(t)) score += 10
      if (BAD.test(t) && !/\bremix\b.*\boriginal\b/i.test(t)) score -= 40
      return { ...r, score }
    })
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best) throw new Error(`Lagu "${meta.title}" tidak ditemukan di YouTube.`)

  return {
    status: true,
    source: 'spotify',
    spotify_url: url.href,
    title: meta.title,
    artist: meta.artist,
    album_art: meta.art,
    matched: {
      title: best.title,
      duration: best.duration,
      uploader: best.uploader,
      url: best.url,
      confidence: best.score >= 60 ? 'high' : best.score >= 30 ? 'medium' : 'low',
    },
    note: 'Audio diambil dari YouTube karena Spotify memakai DRM.',
  }
}

/** Ambil metadata lewat oEmbed resmi Spotify (dokumentasi publik) */
async function spotifyMeta(href) {
  const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(href)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)

  let data
  try {
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': 'HABI-API/1.0', Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Spotify oEmbed membalas HTTP ${res.status}`)
    data = await res.json()
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Request ke Spotify timeout.')
    throw new Error(`Gagal membaca metadata Spotify: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }

  const title = cleanText(data?.title || '')
  if (!title) throw new Error('Metadata Spotify kosong — link mungkin tidak valid.')

  // oEmbed: author_name hanya ada di track/playlist tertentu.
  // Fallback: ambil dari iframe_url atau scrape singkat halaman embed.
  let artist = cleanText(data?.author_name || '')
  if (!artist) artist = await artistFromEmbed(href)

  return {
    title,
    artist: artist || 'Unknown',
    art: data?.thumbnail_url || null,
  }
}

/** Halaman embed Spotify lebih ringan daripada halaman utama */
async function artistFromEmbed(href) {
  try {
    const embed = href.replace('/track/', '/embed/track/').split('?')[0]
    const res = await fetch(embed, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return ''
    const html = await res.text()

    // 1) __NEXT_DATA__ — paling rapi
    const nd = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
    if (nd) {
      try {
        const parsed = JSON.parse(nd[1])
        const name =
          extractArtist(parsed?.props?.pageProps?.state?.data?.entity) ||
          deepFindArtist(parsed)
        if (name) return name
      } catch { /* coba cara lain */ }
    }

    // 2) link ke /artist/ pada markup
    const link = html.match(/href="\/artist\/[^"]*"[^>]*>([^<]{1,80})</i)
    if (link) return cleanText(decodeEntities(link[1]))

    return ''
  } catch {
    return ''
  }
}

/** Ambil artis langsung dari entity Spotify */
function extractArtist(entity) {
  if (!entity || typeof entity !== 'object') return ''
  const a = entity.artists
  if (Array.isArray(a) && a[0]?.name) return cleanText(a[0].name)
  if (typeof a?.name === 'string') return cleanText(a.name)
  if (Array.isArray(entity.artists?.items) && entity.artists.items[0]?.name) {
    return cleanText(entity.artists.items[0].name)
  }
  return ''
}

/** Cari nama artis di dalam object JSON (rekursif, aman) */
function deepFindArtist(node, depth = 0) {
  if (!node || depth > 8) return ''
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = deepFindArtist(item, depth + 1)
      if (r) return r
    }
    return ''
  }
  if (typeof node !== 'object') return ''

  // Codecollection > Track > artist
  const track = node.track || node.trackUnion
  if (track && typeof track === 'object') {
    const a = track.artists
    if (Array.isArray(a) && a[0]?.name) return cleanText(a[0].name)
    if (typeof a?.name === 'string') return cleanText(a.name)
  }

  for (const v of Object.values(node)) {
    const r = deepFindArtist(v, depth + 1)
    if (r) return r
  }
  return ''
}

function pick(hay, re) {
  const m = hay.match(re)
  return m ? decodeEntities(m[1]) : null
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
}

function cleanText(s) {
  return String(s)
    .replace(/\s*\|\s*Spotify\s*$/i, '')
    .replace(/\s*[-–]\s*Song\s*·\s*\d{4}\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---------------------------------------------------------
 * Thumbnail YouTube (dikembalikan langsung, tanpa unduh)
 * ------------------------------------------------------- */
export function youtubeThumbnail(videoId, quality = 'maxres') {
  const q = ['maxres', 'sddefault', 'hqdefault'].includes(quality) ? quality : 'maxres'
  return `https://i.ytimg.com/vi/${videoId}/${q}.jpg`
}

export default { runYtDlp, getInfo, search, spotifyToYoutube, youtubeThumbnail }
