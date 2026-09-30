/**
 * =========================================================
 *  Studio — Sticker, Welcome Card, Fake Reply
 *
 *  Fitur yang di-port dari bot WhatsApp HABI ke REST API.
 *  Semua digambar di server sendiri memakai @napi-rs/canvas.
 * =========================================================
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dns from 'node:dns/promises'
import net from 'node:net'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cache = {}
function load(name) {
  if (cache[name]) return cache[name]
  try {
    cache[name] = require(name)
  } catch (err) {
    throw new Error(`Library "${name}" belum terpasang. Jalankan: npm install ${name} — (${err.message})`)
  }
  return cache[name]
}

const canvasLib = () => load('@napi-rs/canvas')
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES) || 8 * 1024 * 1024
const MAX_BINARY_BYTES = Number(process.env.MAX_BINARY_BYTES) || 50 * 1024 * 1024
const FETCH_TIMEOUT = Number(process.env.IMAGE_FETCH_TIMEOUT_MS) || 15000

/* =========================================================
 *  AMAN: anti-SSRF + limit ukuran
 * ======================================================= */

const BLOCKED_V4 = [
  [10, 8], [127, 8], [169, 254], [172, 16], [192, 168], [100, 64],
]

function isPrivateV4(ip) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0) return true
  if (a >= 224) return true
  return BLOCKED_V4.some(([x, y]) => a === x && b === y)
}

function isPrivateV6(ip) {
  const s = ip.toLowerCase()
  return (
    s === '::' || s === '::1' ||
    s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd') ||
    s.startsWith('::ffff:')
  )
}

function isPrivateIp(ip) {
  const type = net.isIP(ip)
  if (type === 4) return isPrivateV4(ip)
  if (type === 6) return isPrivateV6(ip)
  return true
}

/**
 * Error khusus saat URL ditolak oleh guard.
 * Dibedakan dari error lain supaya pemanggil bisa membedakannya:
 * URL yang DITOLAK harus muncul ke user, sedangkan gambar yang
 * sekadar gagal dimuat (404, timeout) boleh diam-diam pakai fallback.
 */
export class UrlRejectedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UrlRejectedError'
    this.rejected = true
  }
}

/** Pastikan URL aman: hanya http(s) dan bukan alamat internal */
export async function assertSafeUrl(inputUrl) {
  let url
  try {
    url = new URL(inputUrl)
  } catch {
    throw new UrlRejectedError('URL tidak valid.')
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new UrlRejectedError('URL harus diawali http:// atau https://')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const literal = net.isIP(host)
  const addrs = literal ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => [])
  if (!addrs.length) throw new Error(`Host "${url.hostname}" tidak bisa diakses.`)
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new UrlRejectedError('URL ditolak: alamat internal/network lokal tidak diizinkan.')
    }
  }
  return url
}

/**
 * Ambil file gambar dari URL dengan batas ukuran & timeout.
 * @returns {Promise<Buffer>}
 */
export async function fetchImage(rawUrl) {
  const { buffer } = await fetchBinary(rawUrl, { maxBytes: MAX_IMAGE_BYTES })
  return buffer
}

/**
 * Ambil file apa pun (bukan cuma gambar) dari URL.
 * Sama seperti fetchImage, tapi batas ukuran lebih besar dan
 * tidak installment content-type.
 * @returns {Promise<{buffer: Buffer, contentType: string, filename: string}>}
 */
export async function fetchBinary(rawUrl, { maxBytes = MAX_BINARY_BYTES } = {}) {
  const url = await assertSafeUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`Gambar gagal diambil: HTTP ${res.status}`)

    // Hentikan sedini mungkin kalau server sudah bilang terlalu besar
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared && declared > maxBytes) {
      throw new Error(`File terlalu besar (${(declared / 1048576).toFixed(1)} MB). Maks ${maxBytes / 1048576} MB.`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('Respons gambar tidak punya body.')

    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        try { await reader.cancel() } catch { /* abaikan */ }
        throw new Error(`File terlalu besar. Maks ${maxBytes / 1048576} MB.`)
      }
      chunks.push(Buffer.from(value))
    }
    if (!total) throw new Error('File kosong.')

    const type = res.headers.get('content-type') || 'application/octet-stream'
    const name = decodeURIComponent(url.pathname.split('/').pop() || '').slice(0, 80) || 'file'
    return { buffer: Buffer.concat(chunks), contentType: type.split(';')[0].trim(), filename: name }
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Request ke server gambar timeout.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/* =========================================================
 *  Util gambar
 * ======================================================= */

function roundedRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

function shrinkToFit(ctx, text, maxWidth, start, min = 12, weight = 700) {
  let size = start
  while (size > min) {
    ctx.font = `${weight} ${size}px Arial, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) return size
    size -= 1
  }
  return min
}

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Ambil data URL (data:image/...) jadi Buffer */
function fromDataUrl(dataUrl) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(String(dataUrl || '').trim())
  if (!m) throw new Error('Data URL tidak valid. Gunakan format data:image/png;base64,...')
  return Buffer.from(m[1], 'base64')
}

/**
 * Muat gambar untuk elemen opsional (avatar / latar / kartu).
 * - URL yang DITOLAK guard  → lempar error, jangan ditelan diam-diam
 * - Gambar yang gagal dimuat  → null, pemanggil pakai fallback
 */
async function loadOptionalImage(source, loadImage) {
  if (!source) return null
  try {
    return await loadImage(await resolveSource(source))
  } catch (err) {
    if (err instanceof UrlRejectedError) throw err
    return null
  }
}

/** Terima URL http(s) maupun data URL, kembalikan Buffer gambar */
async function resolveSource(source) {
  const raw = String(source || '').trim()
  if (!raw) throw new Error('Parameter "image" wajib diisi.')
  if (/^data:/i.test(raw)) return fromDataUrl(raw)
  return fetchImage(raw)
}

/* =========================================================
 *  1) STICKER MAKER
 *  Potret 512×512, gaya WhatsApp (tepi putih + rounded).
 * ======================================================= */

export async function makeSticker({
  image,
  format = 'webp',
  padding = 8,
  radius = 64,
  background = '#ffffff',
} = {}) {
  const { createCanvas, loadImage } = canvasLib()
  const buffer = await resolveSource(image)
  const img = await loadImage(buffer)

  const size = 512
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  const pad = Math.min(Math.max(Number(padding) || 0, 0), 96)
  const rad = Math.min(Math.max(Number(radius) || 0, 0), pad + size / 2)

  ctx.fillStyle = background
  ctx.fillRect(0, 0, size, size)

  const inner = size - pad * 2
  // Rasio gambar: pakai contain supaya tidak gepeng
  const scale = Math.min(inner / img.width, inner / img.height)
  const w = img.width * scale
  const h = img.height * scale
  const x = pad + (inner - w) / 2
  const y = pad + (inner - h) / 2

  ctx.save()
  if (rad > 0) {
    roundedRect(ctx, x, y, w, h, rad)
    ctx.clip()
  }
  ctx.drawImage(img, x, y, w, h)
  ctx.restore()

  const out = String(format).toLowerCase() === 'png' ? 'image/png' : 'image/webp'
  return { buffer: canvas.toBuffer(out), mime: out, width: size, height: size }
}

/* =========================================================
 *  2) WELCOME CARD
 *  Kartu sambutan grup ala bot HABI.
 * ======================================================= */

const ACCENTS = {
  green: '#25D366', blue: '#53BDEB', purple: '#A855F7',
  pink: '#F472B6', orange: '#FB923C', red: '#F87171', gold: '#D7AE67',
}

export async function welcomeCard({
  name = 'Member Baru',
  tag = '',
  group = 'Grup WhatsApp',
  members = '',
  date = '',
  custom = '',
  accent = 'green',
  avatar = '',
  background = '',
} = {}) {
  const { createCanvas, loadImage } = canvasLib()
  const W = 1000
  const H = 460
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  const color = ACCENTS[String(accent).toLowerCase()] || accent || ACCENTS.green

  // Latar
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#101a14')
  grad.addColorStop(0.5, '#0d1512')
  grad.addColorStop(1, '#12100d')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Motif lingkaran samar
  ctx.globalAlpha = 0.07
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(W - 90, 60, 220, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(40, H - 20, 170, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1

  // Foto khusus kalau ada
  let bgImg = null
  if (background) {
    bgImg = await loadOptionalImage(background, loadImage)
  }
  if (bgImg) {
    ctx.save()
    ctx.globalAlpha = 0.22
    const sc = Math.max(W / bgImg.width, H / bgImg.height)
    const dw = bgImg.width * sc
    const dh = bgImg.height * sc
    ctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh)
    ctx.restore()
  }

  // Panel
  const PX = 46
  const PY = 44
  const PW = W - PX * 2
  const PH = H - PY * 2
  ctx.fillStyle = 'rgba(255,255,255,0.055)'
  roundedRect(ctx, PX, PY, PW, PH, 34)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 2
  roundedRect(ctx, PX, PY, PW, PH, 34)
  ctx.stroke()

  // Avatar lingkaran
  const A = 150
  const AX = PX + 60
  const AY = PY + (PH - A) / 2
  let av = null
  if (avatar) {
    av = await loadOptionalImage(avatar, loadImage)
  }
  ctx.save()
  ctx.beginPath()
  ctx.arc(AX + A / 2, AY + A / 2, A / 2, 0, Math.PI * 2)
  ctx.clip()
  if (av) {
    const s = Math.max(A / av.width, A / av.height)
    const w = av.width * s
    const h = av.height * s
    ctx.drawImage(av, AX + (A - w) / 2, AY + (A - h) / 2, w, h)
  } else {
    const inits = String(name || 'M')
      .trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map((w) => w[0]).join('').toUpperCase() || 'M'
    ctx.fillStyle = color
    ctx.fillRect(AX, AY, A, A)
    ctx.fillStyle = '#0b0f0c'
    ctx.font = '900 64px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(inits, AX + A / 2, AY + A / 2)
  }
  ctx.restore()

  // Cincin aksen
  ctx.strokeStyle = color
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(AX + A / 2, AY + A / 2, A / 2 + 9, 0, Math.PI * 2)
  ctx.stroke()

  // Teks
  const TX = AX + A + 56
  const maxW = W - TX - PX - 30

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  const label = 'WELCOME'
  ctx.font = '800 22px Arial, sans-serif'
  ctx.fillStyle = color
  let cursorY = PY + 78
  ctx.fillText(label, TX, cursorY)

  const title = String(name || 'Member Baru').slice(0, 40)
  cursorY += 62
  const nameSize = shrinkToFit(ctx, title, maxW, 52, 22, 900)
  ctx.font = `900 ${nameSize}px Arial, sans-serif`
  ctx.fillStyle = '#ffffff'
  ctx.fillText(title, TX, cursorY)

  if (tag) {
    cursorY += 40
    ctx.font = '600 22px Arial, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.62)'
    ctx.fillText(String(tag).slice(0, 40), TX, cursorY)
  }

  cursorY += 46
  ctx.font = '500 21px Arial, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  const meta = [group, members].filter(Boolean).map(String).join('  •  ')
  if (meta) ctx.fillText(meta.slice(0, 70), TX, cursorY)

  if (custom) {
    cursorY += 40
    ctx.font = '500 20px Arial, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.42)'
    ctx.fillText(String(custom).slice(0, 80), TX, cursorY)
  }

  // Tanggal di kanan bawah
  const stamp = String(date || new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }))
  ctx.font = '600 18px Arial, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.textAlign = 'right'
  ctx.fillText(stamp, W - PX - 34, H - PY - 30)

  return { buffer: canvas.toBuffer('image/png'), mime: 'image/png', width: W, height: H }
}

/* =========================================================
 *  Reaction bar — digambar sebagai vektor
 *
 *  Server tidak punya font emoji warna, jadi reaction bar
 *  digambar tangan memakai path canvas. Hasilnya konsisten,
 *  tajam di ukuran berapa pun, dan tetap offline.
 * ======================================================= */

const SKIN = '#F6C944'
const SKIN_DARK = '#E0A92E'
const HEART = '#F5465C'

function ell(ctx, cx, cy, rx, ry) {
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawFace(ctx, x, y, s) {
  ell(ctx, x + s / 2, y + s / 2, s * 0.46, s * 0.46)
}

/** @param {string} kind  thumb | heart | joy | wow | sad | pray */
function drawReaction(ctx, kind, x, y, s) {
  ctx.save()
  switch (kind) {
    case 'thumb': {
      ctx.fillStyle = SKIN
      roundedRect(ctx, x + s * 0.44, y + s * 0.58, s * 0.40, s * 0.30, s * 0.10)
      ctx.fill()
      roundedRect(ctx, x + s * 0.30, y + s * 0.54, s * 0.42, s * 0.34, s * 0.12)
      ctx.fill()
      roundedRect(ctx, x + s * 0.28, y + s * 0.18, s * 0.17, s * 0.40, s * 0.085)
      ctx.fill()
      ctx.fillStyle = SKIN_DARK
      for (let i = 0; i < 3; i++) {
        roundedRect(ctx, x + s * (0.46 + i * 0.11), y + s * 0.62, s * 0.045, s * 0.16, s * 0.02)
        ctx.fill()
      }
      break
    }
    case 'heart': {
      ctx.fillStyle = HEART
      const cx = x + s / 2
      const cy = y + s * 0.54
      ctx.beginPath()
      ctx.moveTo(cx, cy + s * 0.30)
      ctx.bezierCurveTo(cx - s * 0.60, cy - s * 0.08, cx - s * 0.34, cy - s * 0.52, cx, cy - s * 0.16)
      ctx.bezierCurveTo(cx + s * 0.34, cy - s * 0.52, cx + s * 0.60, cy - s * 0.08, cx, cy + s * 0.30)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ell(ctx, cx - s * 0.20, cy - s * 0.16, s * 0.07, s * 0.05)
      break
    }
    case 'joy': {
      ctx.fillStyle = SKIN
      drawFace(ctx, x, y, s)
      ctx.strokeStyle = '#5A3A12'
      ctx.lineWidth = s * 0.055
      ctx.lineCap = 'round'
      // mata tertutup tertawa
      for (const dx of [-0.17, 0.17]) {
        ctx.beginPath()
        ctx.arc(x + s * (0.5 + dx), y + s * 0.44, s * 0.10, Math.PI * 1.15, Math.PI * 1.85)
        ctx.stroke()
      }
      // mulut terbuka + gigi
      ctx.fillStyle = '#5A3A12'
      ctx.beginPath()
      ctx.ellipse(x + s * 0.5, y + s * 0.63, s * 0.22, s * 0.18, 0, 0, Math.PI)
      ctx.fill()
      ctx.fillStyle = '#fff'
      roundedRect(ctx, x + s * 0.31, y + s * 0.50, s * 0.38, s * 0.07, s * 0.03)
      ctx.fill()
      // air mata
      ctx.fillStyle = '#5FC8F5'
      ell(ctx, x + s * 0.14, y + s * 0.62, s * 0.07, s * 0.10)
      ell(ctx, x + s * 0.86, y + s * 0.62, s * 0.07, s * 0.10)
      break
    }
    case 'wow': {
      ctx.fillStyle = SKIN
      drawFace(ctx, x, y, s)
      ctx.fillStyle = '#3A2A10'
      ell(ctx, x + s * 0.36, y + s * 0.42, s * 0.075, s * 0.095)
      ell(ctx, x + s * 0.64, y + s * 0.42, s * 0.075, s * 0.095)
      ctx.fillStyle = '#5A3A12'
      ell(ctx, x + s * 0.5, y + s * 0.65, s * 0.10, s * 0.13)
      break
    }
    case 'sad': {
      ctx.fillStyle = SKIN
      drawFace(ctx, x, y, s)
      ctx.strokeStyle = '#5A3A12'
      ctx.lineWidth = s * 0.055
      ctx.lineCap = 'round'
      for (const [dx, dir] of [[-0.17, 1], [0.17, -1]]) {
        ctx.beginPath()
        ctx.moveTo(x + s * (0.5 + dx - dir * 0.10), y + s * 0.29)
        ctx.lineTo(x + s * (0.5 + dx + dir * 0.10), y + s * 0.36)
        ctx.stroke()
      }
      ctx.fillStyle = '#3A2A10'
      ell(ctx, x + s * 0.36, y + s * 0.46, s * 0.065, s * 0.08)
      ell(ctx, x + s * 0.64, y + s * 0.46, s * 0.065, s * 0.08)
      ctx.strokeStyle = '#5A3A12'
      ctx.beginPath()
      ctx.arc(x + s * 0.5, y + s * 0.78, s * 0.16, Math.PI * 1.22, Math.PI * 1.78)
      ctx.stroke()
      ctx.fillStyle = '#5FC8F5'
      ell(ctx, x + s * 0.36, y + s * 0.60, s * 0.07, s * 0.11)
      break
    }
    case 'pray': {
      // Dua tanganmeeting di ujung atas → bentuk V
      ctx.fillStyle = '#F2C79B'
      for (const [ang, off] of [[0.34, -0.05], [-0.34, 0.05]]) {
        ctx.save()
        ctx.translate(x + s * (0.5 + off), y + s * 0.66)
        ctx.rotate(ang)
        roundedRect(ctx, -s * 0.075, -s * 0.34, s * 0.15, s * 0.56, s * 0.075)
        ctx.fill()
        // booksedikit
        ctx.fillStyle = 'rgba(0,0,0,0.08)'
        roundedRect(ctx, -s * 0.075, s * 0.10, s * 0.15, s * 0.12, s * 0.04)
        ctx.fill()
        ctx.fillStyle = '#F2C79B'
        ctx.restore()
      }
      break
    }
    default:
      ctx.fillStyle = SKIN
      drawFace(ctx, x, y, s)
  }
  ctx.restore()
}

export const REACTIONS = ['thumb', 'heart', 'joy', 'wow', 'sad', 'pray']

export const REPLY_VARIANTS = {
  1: 'Balasan teks sederhana',
  2: 'Balasan dengan kutipan',
  3: 'Balasan dengan gambar',
  4: 'Gaya pixel / block',
  5: 'Kartu tautan',
}

/** Pecah teks jadi maksimal 2 baris pendek */
function shortLines(ctx, text, maxW, maxLines = 3) {
  const all = wrap(ctx, text, maxW)
  if (all.length <= maxLines) return all
  const kept = all.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, '')}…`
  return kept
}

export async function fakeReply({
  variant = 1,
  name = 'HABI Official',
  text = 'Halo dunia',
  target = '',
  targetName = 'Kamu',
  time = '09.41',
  image = '',
  url = 'https://habibicloudserver.dpdns.org',
  title = 'Habibih Cloud ID',
  description = 'REST API WhatsApp gratis & self-hosted',
} = {}) {
  const { createCanvas, loadImage } = canvasLib()
  const v = Math.min(Math.max(parseInt(variant, 10) || 1, 1), 5)

  const W = 680
  const M = 26
  const BW = W - M * 2
  const TEXT_W = BW - 48              // ruang teks di dalam bubble
  const FONT_SIZE = 26
  const LINE_H = 34

  // ── Tahap 1: ukur supaya tinggi kanvas pas ──
  const probe = createCanvas(10, 10).getContext('2d')
  probe.font = `400 ${FONT_SIZE}px Arial, sans-serif`
  const lines = shortLines(probe, text, TEXT_W, 3)

  const quoteH = 62
  const bodyH = lines.length * LINE_H + 10
  const bubH = quoteH + bodyH + 30

  const TOP = 24
  const REACT_H = 44
  const barBottom = TOP + REACT_H + 14
  const bubbleTop = barBottom + 26            // ruang untuk nama pengirim
  let cursor = bubbleTop + bubH + 20

  const IMG_H = v === 3 ? 250 : v === 5 ? 130 : 0
  if (v === 3) cursor += IMG_H + 12 + 46 + 18   // gambar + judul
  if (v === 5) cursor += IMG_H + 12 + 100 + 18  // kartu tautan
  const H = Math.round(cursor + 18)

  // ── Tahap 2: gambar ──
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // Latar + polanous
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, v === 4 ? '#0b0f14' : '#0b141a')
  g.addColorStop(1, '#0a0f0c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.globalAlpha = 0.05
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.4
  for (let i = -H; i < W; i += 26) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke()
  }
  ctx.globalAlpha = 1

  // ── Reaction bar ──
  let rx = M
  for (const kind of REACTIONS) {
    const bw = 46
    ctx.fillStyle = 'rgba(31,44,37,0.95)'
    roundedRect(ctx, rx, TOP, bw, REACT_H, REACT_H / 2)
    ctx.fill()
    drawReaction(ctx, kind, rx + 4, TOP + 3, REACT_H - 6)
    rx += bw + 6
  }
  // tombol plus
  const pw = 40
  ctx.fillStyle = 'rgba(31,44,37,0.95)'
  roundedRect(ctx, rx, TOP, pw, REACT_H, REACT_H / 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(rx + pw / 2 - 8, TOP + REACT_H / 2)
  ctx.lineTo(rx + pw / 2 + 8, TOP + REACT_H / 2)
  ctx.moveTo(rx + pw / 2, TOP + REACT_H / 2 - 8)
  ctx.lineTo(rx + pw / 2, TOP + REACT_H / 2 + 8)
  ctx.stroke()

  // ── Nama pengirim ──
  ctx.font = '600 19px Arial, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(String(name).slice(0, 34), M, bubbleTop - 12)

  // ── Bubble ──
  ctx.fillStyle = v === 4 ? '#1b2416' : '#1f2c33'
  roundedRect(ctx, M, bubbleTop, BW, bubH, 18)
  ctx.fill()

  // Baris kutipan
  ctx.fillStyle = v === 4 ? '#4d7a35' : '#2a5c4a'
  roundedRect(ctx, M + 12, bubbleTop + 12, 5, quoteH - 22, 3)
  ctx.fill()
  ctx.font = '600 19px Arial, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.58)'
  ctx.fillText(String(targetName || 'Kamu').slice(0, 28), M + 30, bubbleTop + 34)
  ctx.font = '400 19px Arial, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.40)'
  ctx.fillText(String(target || '').slice(0, 52), M + 30, bubbleTop + 60)

  // Teks balasan
  ctx.font = `400 ${FONT_SIZE}px Arial, sans-serif`
  ctx.fillStyle = '#e9edef'
  let ty = bubbleTop + quoteH + 36
  for (const line of lines) {
    ctx.fillText(line, M + 22, ty)
    ty += LINE_H
  }

  // Timestamp
  ctx.font = '400 16px Arial, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.42)'
  ctx.textAlign = 'right'
  ctx.fillText(time, W - M - 20, bubbleTop + bubH - 14)
  ctx.textAlign = 'left'

  // ── Varian 3: balasan berisi gambar ──
  if (v === 3) {
    const y = bubbleTop + bubH + 20
    ctx.fillStyle = v === 4 ? '#1b2416' : '#1f2c33'
    roundedRect(ctx, M, y, BW, IMG_H + 12 + 46, 18)
    ctx.fill()
    ctx.save()
    roundedRect(ctx, M + 10, y + 10, BW - 20, IMG_H, 12)
    ctx.clip()
    let pic = null
    pic = await loadOptionalImage(image, loadImage)
    if (pic) {
      const s = Math.max((BW - 20) / pic.width, IMG_H / pic.height)
      ctx.drawImage(pic, M + 10 + ((BW - 20) - pic.width * s) / 2, y + 10 + (IMG_H - pic.height * s) / 2, pic.width * s, pic.height * s)
    } else {
      ctx.fillStyle = '#2b3a33'
      ctx.fillRect(M + 10, y + 10, BW - 20, IMG_H)
      ctx.fillStyle = 'rgba(255,255,255,0.32)'
      ctx.font = '600 20px Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Gambar tidak tersedia', W / 2, y + 10 + IMG_H / 2)
      ctx.textAlign = 'left'
    }
    ctx.restore()
    ctx.font = '400 22px Arial, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.62)'
    ctx.fillText(String(title).slice(0, 52), M + 20, y + IMG_H + 46)
  }

  // ── Varian 5: kartu tautan ──
  if (v === 5) {
    const y = bubbleTop + bubH + 20
    const CARD_BODY = 100
    ctx.fillStyle = v === 4 ? '#1b2416' : '#1f2c33'
    roundedRect(ctx, M, y, BW, IMG_H + 12 + CARD_BODY, 18)
    ctx.fill()
    ctx.save()
    roundedRect(ctx, M + 10, y + 10, BW - 20, IMG_H, 12)
    ctx.clip()
    let pic = null
    pic = await loadOptionalImage(image, loadImage)
    if (pic) {
      const s = Math.max((BW - 20) / pic.width, IMG_H / pic.height)
      ctx.drawImage(pic, M + 10 + ((BW - 20) - pic.width * s) / 2, y + 10 + (IMG_H - pic.height * s) / 2, pic.width * s, pic.height * s)
    } else {
      const lg = ctx.createLinearGradient(M + 10, y + 10, M + BW - 10, y + IMG_H)
      lg.addColorStop(0, '#134e4a')
      lg.addColorStop(1, '#0f766e')
      ctx.fillStyle = lg
      ctx.fillRect(M + 10, y + 10, BW - 20, IMG_H)
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.font = '700 42px Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('HABI', W / 2, y + 10 + IMG_H / 2 + 15)
      ctx.textAlign = 'left'
    }
    ctx.restore()
    const ty0 = y + IMG_H + 12
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(M, ty0, BW, 2)
    ctx.font = '600 23px Arial, sans-serif'
    ctx.fillStyle = '#e9edef'
    ctx.fillText(String(title).slice(0, 44), M + 20, ty0 + 32)
    ctx.font = '400 19px Arial, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.50)'
    ctx.fillText(String(description).slice(0, 56), M + 20, ty0 + 58)
    ctx.font = '400 16px Arial, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.38)'
    ctx.fillText(String(url).slice(0, 58), M + 20, ty0 + 82)
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    mime: 'image/png',
    width: W,
    height: canvas.height,
    variant: v,
    variant_name: REPLY_VARIANTS[v],
  }
}

export default {
  makeSticker,
  welcomeCard,
  fakeReply,
  fetchImage,
  fetchBinary,
  assertSafeUrl,
  UrlRejectedError,
  REPLY_VARIANTS,
  REACTIONS,
}
