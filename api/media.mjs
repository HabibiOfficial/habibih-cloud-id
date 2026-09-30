/**
 * =========================================================
 *  Media Resolver — TikTok / Facebook / URL umum
 *
 *  Rantai resolução (sesuai urutan bot HABI, dimirror ke sini):
 *    1. yt-dlp native   → pilihan utama, milik sendiri
 *    2. tikwm           → fallback khusus TikTok
 *    3. gateway gencipta→ fallback terakhir (pakai env key)
 *
 *  Tidak ada proses unduhan di file ini; semua endpoint ini
 *  hanya mengembalikan URL media siap pakai.
 * =========================================================
 */

import { existsSync } from 'node:fs'
import { runYtDlp } from './downloader.mjs'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/* ---------------------------------------------------------
 * Deteksi platform dari hostname
 * ------------------------------------------------------- */
const PLATFORMS = [
  ['tiktok', /(?:^|\.)tiktok\.com$/i],
  ['instagram', /(?:^|\.)instagram\.com$/i],
  ['facebook', /(?:^|\.)(?:facebook\.com|fb\.watch|m\.facebook\.com)$/i],
  ['twitter', /(?:^|\.)(?:twitter\.com|x\.com)$/i],
  ['youtube', /(?:^|\.)(?:youtube\.com|youtu\.be|youtube\.nl)$/i],
  ['soundcloud', /(?:^|\.)soundcloud\.com$/i],
  ['pinterest', /(?:^|\.)pinterest\./i],
  ['reddit', /(?:^|\.)reddit\.com$/i],
  ['vk', /(?:^|\.)vk\.com$/i],
  ['douyin', /(?:^|\.)douyin\.com$/i],
]

export function detectPlatform(inputUrl) {
  let url
  try {
    url = new URL(inputUrl)
  } catch {
    throw new Error('URL tidak valid.')
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('URL harus diawali http:// atau https://')
  }
  const host = url.hostname.toLowerCase()
  for (const [name, re] of PLATFORMS) {
    if (re.test(host)) return name
  }
  return 'other'
}

/* ---------------------------------------------------------
 * Helper
 * ------------------------------------------------------- */
function fetchJson(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    })
    .finally(() => clearTimeout(timer))
}

/** Buang query string yang tidak perlu (signature TikTok rapuh) */
function tidy(url) {
  try {
    const u = new URL(url)
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', '_r', 'is_from_webapp'].forEach(
      (k) => u.searchParams.delete(k)
    )
    return u.toString()
  } catch {
    return url
  }
}

/* ---------------------------------------------------------
 * Cookie
 *
 * Beberapa platform (Instagram terutama) menolak request
 * tanpa cookie. Cookie dibaca dari file format Netscape
 * yang taruh di server, lalu diarahkan lewat env:
 *
 *   HABI_INSTAGRAM_COOKIES=/home/deploy/cookies/instagram.txt
 *   HABI_TIKTOK_COOKIES=/home/deploy/cookies/tiktok.txt
 *
 * File ini TIDAK ada di repo — hanya di server.
 * ------------------------------------------------------- */
function cookiesFor(platform) {
  const file = process.env[`HABI_${String(platform).toUpperCase()}_COOKIES`]
  if (!file) return []
  try {
    if (!existsSync(file)) return []
  } catch {
    return []
  }
  return ['--cookies', file]
}

/* ---------------------------------------------------------
 * 1) yt-dlp native — jalur utama & milik sendiri
 * ------------------------------------------------------- */
async function viaYtDlp(url, { wantAudio = false, platform = 'other' } = {}) {
  const { stdout } = await runYtDlp(
    [url, '-j', '--no-playlist', '--no-warnings', '--skip-download', ...cookiesFor(platform)],
    55000
  )

  const line = stdout.trim().split('\n').filter(Boolean)[0]
  if (!line) throw new Error('Metadata tidak ditemukan.')

  let d
  try {
    d = JSON.parse(line)
  } catch {
    throw new Error('Gagal membaca metadata.')
  }

  const formats = Array.isArray(d.formats) && d.formats.length ? d.formats : []
  const usable = formats.filter((f) => f && f.url && f.protocol !== 'mhtml')

  const sizeOf = (f) => (f.filesize || f.filesize_approx || null)

  // Audio-only: video stream-nya "none" tapi ada codec audio
  const audio = usable
    .filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0]

  // Video: kalau ada format combined (vcodec+acodec) ambil yang terbaik,
  // kalau tidak, ambil stream video TERPISA dengan resolutions tertinggi.
  const combined = usable
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
    .sort(
      (a, b) =>
        (b.height || 0) - (a.height || 0) ||
        (b.vbr || b.tbr || 0) - (a.vbr || a.tbr || 0) ||
        (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0)
    )[0]

  const videoOnly = usable
    .filter((f) => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'))
    .sort(
      (a, b) =>
        (b.height || 0) - (a.height || 0) ||
        (b.vbr || b.tbr || 0) - (a.vbr || a.tbr || 0)
    )[0]

  const main = wantAudio ? audio : combined || videoOnly
  if (!main) throw new Error('Tidak ada stream yang bisa diambil dari URL ini.')

  return {
    source: 'yt-dlp',
    id: d.id,
    title: d.title || d.fulltitle || 'Tanpa judul',
    description: (d.description || '').slice(0, 500) || null,
    uploader: d.uploader || d.channel || d.uploader_id || null,
    duration: d.duration ?? null,
    thumbnail: d.thumbnail || null,
    webpage_url: d.webpage_url || url,
    view_count: d.view_count ?? null,
    like_count: d.like_count ?? null,
    is_live: Boolean(d.is_live),
    media: {
      video: wantAudio
        ? null
        : {
            url: tidy(main.url),
            ext: main.ext || null,
            width: main.width ?? null,
            height: main.height ?? null,
            fps: main.fps ?? null,
            size: sizeOf(main),
            has_audio: Boolean(combined),
          },
      audio: audio
        ? {
            url: tidy(audio.url),
            ext: audio.ext || null,
            abr: audio.abr ?? null,
            size: sizeOf(audio),
          }
        : null,
    },
    available_formats: usable.length,
    note: combined
      ? 'Video sudah termasuk suara.'
      : 'Stream video terpisah, audio tersedia di field media.audio.',
  }
}

/* ---------------------------------------------------------
 * 2) tikwm — fallback TikTok (no-watermark)
 * ------------------------------------------------------- */
async function viaTikwm(url) {
  const json = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`)
  if (json?.code !== 0 || !json?.data) throw new Error('tikwm tidak mengembalikan data.')

  const play = json.data.hdplay || json.data.play
  if (!play) throw new Error('URL video dari tikwm tidak ditemukan.')

  const musicUrl = json.data.music || json.data.musicplayurl || null
  const full = play.startsWith('http') ? play : `https://www.tikwm.com${play}`

  return {
    source: 'tikwm',
    title: json.data.title || 'Tanpa judul',
    uploader: json.data.author?.unique_id || json.data.author?.nickname || null,
    thumbnail: json.data.cover || json.data.dynamic_cover || null,
    duration: json.data.duration ?? null,
    webpage_url: url,
    media: {
      video: { url: full, ext: 'mp4', has_audio: true },
      audio: musicUrl
        ? { url: musicUrl.startsWith('http') ? musicUrl : `https://www.tikwm.com${musicUrl}`, ext: 'mp3' }
        : null,
    },
    available_formats: null,
    note: 'Video no-watermark dari fallback tikwm.',
  }
}

/* ---------------------------------------------------------
 * 3) Gateway gencipta — fallback terakhir (butuh env key)
 * ------------------------------------------------------- */
async function viaGencipta(url, platform) {
  const key = process.env[`HABI_${platform.toUpperCase()}_KEY`] || process.env.HABI_GENCIPTA_KEY
  if (!key) throw new Error('Gateway fallback tidak dikonfigurasi (env key kosong).')

  const json = await fetchJson(
    `https://gateway.gencipta.com/api/downloader/${platform}?url=${encodeURIComponent(url)}`,
    { headers: { Authorization: `Bearer ${key}` } }
  )
  if (!json || json.status !== true) throw new Error('Gateway tidak mengembalikan data.')

  const data = Array.isArray(json.data) ? json.data : []
  const hd = data.find((x) => /_hd$/i.test(x?.type || '') && x?.url)
  const normal = data.find((x) => !/_hd$/i.test(x?.type || '') && x?.url)
  const pick = hd || normal
  if (!pick) throw new Error('Media tidak ditemukan di gateway.')

  const music = data.find((x) => /music|audio/i.test(x?.type || '') && x?.url)

  return {
    source: 'gencipta',
    title: json.title || 'Tanpa judul',
    thumbnail: json.thumbnail || json.cover || null,
    uploader: json.author || null,
    duration: json.duration ?? null,
    webpage_url: url,
    media: {
      video: { url: pick.url, ext: 'mp4', has_audio: true },
      audio: music ? { url: music.url, ext: 'mp3' } : null,
    },
    available_formats: data.length,
    note: 'Diambil dari gateway fallback.',
  }
}

/* ---------------------------------------------------------
 * Resolver utama
 * ------------------------------------------------------- */
export async function resolveMedia(inputUrl, { wantAudio = false } = {}) {
  const platform = detectPlatform(inputUrl)

  const chain = [() => viaYtDlp(inputUrl, { wantAudio, platform })]
  if (platform === 'tiktok') {
    chain.push(() => viaTikwm(inputUrl))
    chain.push(() => viaGencipta(inputUrl, 'tiktok'))
  } else if (platform === 'facebook') {
    chain.push(() => viaGencipta(inputUrl, 'facebook'))
  }

  const attempts = []
  for (const step of chain) {
    try {
      const out = await step()
      return {
        status: true,
        platform,
        url: inputUrl,
        ...out,
        attempts: attempts.length ? [...attempts, { ok: true }] : undefined,
      }
    } catch (err) {
      attempts.push({ ok: false, error: err.message.slice(0, 160) })
    }
  }

  const detail = attempts.map((a, i) => `${i + 1}. ${a.error || 'ok'}`).join(' | ')

  // Instagram hampir selalu butuh cookie. Kalau cookie belum
  // dipasang, poke user ke arah yang benar.
  const cookieHint = (platform) =>
    process.env[`HABI_${String(platform).toUpperCase()}_COOKIES`]
      ? 'Cookie sudah dipasang tapi tetap gagal — kemungkinan post privat, atau cookie-nya kedaluwarsa.'
      : 'Instagram menolak request tanpa login. Owner perlu menyiapkan file cookie (format Netscape) lalu set ' +
        `HABI_${String(platform).toUpperCase()}_COOKIES=/path/cookies.txt di server.`

  if (platform === 'instagram' && !process.env.HABI_INSTAGRAM_COOKIES) {
    throw new Error(
      'Instagram memblokir request anonim, jadi endpoint ini butuh cookie di server. ' +
      cookieHint(platform) +
      ` Detail: ${detail}`
    )
  }

  throw new Error(`Gagal memuat media (${platform}). ${detail}`)
}

/** Alias khusus biar route di server.js enak dibaca */
export const resolveTikTok = (url, opts) => resolveMedia(url, opts)
export const resolveFacebook = (url, opts) => resolveMedia(url, opts)

export default { detectPlatform, resolveMedia, resolveTikTok, resolveFacebook }
