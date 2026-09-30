/**
 * =========================================================
 *  Image Tools — modul native (self-hosted)
 *
 *  Semua fitur di file ini digambar di server kita memakai
 *  @napi-rs/canvas. Tidak ada panggilan ke layanan eksternal.
 * =========================================================
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/* ---------------------------------------------------------
 * Lazy load — biar start server cepat & error lebih jelas
 * ------------------------------------------------------- */
const cache = {}

function load(name) {
  if (cache[name]) return cache[name]
  try {
    cache[name] = require(name)
  } catch (err) {
    throw new Error(
      `Library "${name}" belum terpasang. Jalankan: npm install ${name} — (${err.message})`
    )
  }
  return cache[name]
}

/** Pastikan Buffer, apa pun bentuk balikan library */
function toBuffer(out) {
  if (!out) throw new Error('Library tidak mengembalikan data gambar.')
  if (Buffer.isBuffer(out)) return out
  if (out.image) {
    const img = out.image
    if (Buffer.isBuffer(img)) return img
    if (typeof img === 'string') {
      return Buffer.from(img.replace(/^data:image\/\w+;base64,/, ''), 'base64')
    }
  }
  if (typeof out === 'string') {
    return Buffer.from(out.replace(/^data:image\/\w+;base64,/, ''), 'base64')
  }
  if (out.data) return Buffer.from(out.data)
  throw new Error('Format gambar dari library tidak dikenali.')
}

/* =========================================================
 * 1. BRAT IMAGE
 * ======================================================= */
export async function brat(text, { blur = 0 } = {}) {
  const { bratGen } = load('brat-canvas')
  const buf = await bratGen(String(text).slice(0, 200), { BLUR: Number(blur) || 0 })
  return toBuffer(buf)
}

/* =========================================================
 * 2. BRAT VIDEO (butuh ffmpeg di server)
 * ======================================================= */
export async function bratVideo(text, {
  format = 'mp4',
  fps = 15,
  width = 500,
  height = 500,
  duration = 2,
} = {}) {
  const { bratVid } = require('brat-canvas/video')

  const buf = await bratVid(String(text).slice(0, 120), {
    outputFormat: format === 'webm' ? 'webm' : 'mp4',
    fps: clamp(fps, 5, 30),
    width: clamp(width, 128, 1080),
    height: clamp(height, 128, 1080),
    duration: clamp(duration, 1, 10),
    fast: true,
  })
  return toBuffer(buf)
}

/* =========================================================
 * 3. iPHONE QUOTE (screenshot chat palsu)
 * ======================================================= */
export async function iphoneQuote({
  text,
  time = '09.41',
  batteries = [true, '87%'],
  operator = true,
  timebar = true,
  wifi = true,
  avatar = null,
  clean = true,
} = {}) {
  const { generateIQC } = load('iqc-canvas')

  const opts = {}
  if (batteries) {
    opts.batteries = Array.isArray(batteries) ? batteries : [true, String(batteries)]
  }
  if (operator) opts.operator = true
  if (timebar) opts.timebar = true
  if (wifi) opts.wifi = true
  if (avatar) opts.avatar = avatar

  const out = await generateIQC(String(text).slice(0, 1000), String(time), opts)
  const buf = toBuffer(out)

  // Library selalu menggambar menu Balas/Teruskan/Salin di bawah
  // gelembung chat. Kalau user tidak memintanya, kita crop bagian
  // bawah itu agar hasilnya bersih seperti screenshot biasa.
  if (!clean) return buf
  return cropReplyMenu(buf)
}

/** Potong menu konteks di bagian bawah gambar IQC */
async function cropReplyMenu(buf) {
  try {
    const { createCanvas, loadImage } = load('@napi-rs/canvas')
    const img = await loadImage(buf)
    const W = img.width
    const H = img.height

    const src = createCanvas(W, H)
    const sctx = src.getContext('2d')
    sctx.drawImage(img, 0, 0)
    const px = sctx.getImageData(0, 0, W, H).data

    // Menu konteks = panel abu-abu SOLID yang lebar, mulai tepat
    // di bawah gelembung chat kita. Latar di belakang
    // juga abu-abu tapi blur/berwarna, jadi kita wajib membedakan.
    //
    // Cara: cari tepi bawah panel (baris paling bawah yang abu),
    // lalu naik sampai keluar dari abu.
    const isGray = (i) => {
      const r = px[i], g = px[i + 1], b = px[i + 2]
      // Panel menu = rgb(42,42,42). Latar belakangiqHUE jauh lebih
      // gelap (13,13,13) atau berwarna hijau, jadi filter ketat aman.
      return r >= 38 && r <= 48 && Math.abs(r - g) <= 3 && Math.abs(g - b) <= 3
    }

    const xStart = Math.round(W * 0.05)
    const xEnd = Math.round(W * 0.55)

    const grayRatio = (y) => {
      let gray = 0
      let total = 0
      for (let x = xStart; x < xEnd; x += 3) {
        total++
        if (isGray((y * W + x) * 4)) gray++
      }
      return total ? gray / total : 0
    }

    let menuY = -1

    // Panel menu = blok abu solid dari tengah sampai dasar gambar.
    // Ada baris berisi teks di dalamnya (ikon + label), jadi
    // threshold harus longgar supaya tidak terputus di tengah panel.
    //
    // Strategi: dari bawah naik, dan selama 6 baris berturut-turut
    // masih "sebagian abu" (>=0.5) kita anggap masih di dalam panel.
    // Saat sudah 6 baris berturut-turut NON-abu, itu tepi atas panel.
    const CLEAN_RUN = 6
    let nonGrayRun = 0
    for (let y = H - 1; y > Math.round(H * 0.2); y--) {
      if (grayRatio(y) >= 0.5) {
        menuY = y
        nonGrayRun = 0
      } else {
        nonGrayRun++
        if (nonGrayRun >= CLEAN_RUN && menuY > 0) break
      }
    }

    // Tanpa deteksi, pakai rasio cadangan
    if (menuY < 0) menuY = Math.round(H * 0.55)

    // Sisakan sedikit ruang di atas agar pinggan panel tidak terlihat,
    // tapi tetap cukup untuk timestamp di dalam gelembung chat.
    const newH = Math.max(menuY + 12, 240)

    const out = createCanvas(W, newH)
    const octx = out.getContext('2d')
    octx.drawImage(src, 0, 0, W, newH, 0, 0, W, newH)

    return out.toBuffer('image/png')
  } catch {
    return buf
  }
}

/* =========================================================
 * 4. MEME GENERATOR
 * ======================================================= */
export async function meme({ image, top = '', bottom = '', author = '' } = {}) {
  const { createCanvas, loadImage, GlobalFonts } = load('@napi-rs/canvas')

  // 1) siapkan gambar (dari URL atau base64)
  let img
  if (image && /^https?:\/\//i.test(image)) {
    const res = await fetch(image, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`Gagal mengunduh gambar (HTTP ${res.status}).`)
    const type = res.headers.get('content-type') || ''
    if (!type.startsWith('image/')) throw new Error('URL tersebut bukan gambar.')
    const ab = await res.arrayBuffer()
    img = await loadImage(Buffer.from(ab))
  } else if (image) {
    const raw = String(image).replace(/^data:image\/\w+;base64,/, '')
    img = await loadImage(Buffer.from(raw, 'base64'))
  } else {
    // canvas kosong sebagai fallback
    const c = createCanvas(600, 600)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, 600, 600)
    ctx.fillStyle = '#555'
    ctx.font = 'bold 40px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('HABI API', 300, 310)
    img = await loadImage(c.toBuffer('image/png'))
  }

  // 2) ukuran kanvas mengikuti gambar asli
  const W = Math.min(Math.max(img.width, 240), 1200)
  const H = Math.round((img.height / img.width) * W)

  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  ctx.drawImage(img, 0, 0, W, H)

  // 3) overlay gelap biar teks kebaca
  ctx.fillStyle = 'rgba(0,0,0,0.42)'
  ctx.fillRect(0, 0, W, H)

  // 4) font — pakai Impact kalau ada, else sans-serif Tebal
  const family = pickFont(ctx, [
    'Impact',
    'Arial Black',
    'Anton',
    'DejaVu Sans',
    'sans-serif',
  ])

  const fs = Math.max(28, Math.round(W / 16))
  ctx.font = `bold ${fs}px ${family}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'

  // outline hitam agar kontras
  ctx.strokeStyle = '#000'
  ctx.lineWidth = Math.max(3, Math.round(fs / 9))
  ctx.fillStyle = '#fff'

  if (top) {
    drawWrapped(ctx, top, W, H, fs, 'top')
  }
  if (bottom) {
    drawWrapped(ctx, bottom, W, H, fs, 'bottom')
  }

  // 5) watermark kecil
  if (author) {
    const wf = Math.max(13, Math.round(W / 42))
    ctx.font = `600 ${wf}px sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'
    ctx.lineWidth = Math.max(2, wf / 7)
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'right'
    const label = String(author).slice(0, 40)
    ctx.strokeText(label, W - 10, H - 8)
    ctx.fillText(label, W - 10, H - 8)
  }

  return canvas.toBuffer('image/png')
}

function pickFont(ctx, list) {
  for (const f of list) {
    try {
      if (f === 'sans-serif') break
      const ok = ctx.measureText('Ag').width
      if (ok > 0) return f
    } catch { /* coba berikutnya */ }
  }
  return 'sans-serif'
}

function drawWrapped(ctx, text, W, H, fs, position) {
  const words = String(text).toUpperCase().split(/\s+/)
  const maxW = W - 24
  const lines = []
  let line = ''

  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)

  const lh = fs * 1.12
  const total = lines.length * lh
  const pad = fs * 0.35

  lines.forEach((ln, i) => {
    const y = position === 'top'
      ? pad + i * lh
      : H - pad - total + i * lh
    ctx.strokeText(ln, W / 2, y)
    ctx.fillText(ln, W / 2, y)
  })
}

/* =========================================================
 * 5. WATERMARK / KETERANGAN GAMBAR
 * ======================================================= */
export async function watermark({ image, text = 'HABI API', position = 'br', opacity = 0.75 } = {}) {
  const { createCanvas, loadImage } = load('@napi-rs/canvas')

  if (!image) throw new Error('Parameter "image" wajib diisi.')

  let img
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`Gagal mengunduh gambar (HTTP ${res.status}).`)
    img = await loadImage(Buffer.from(await res.arrayBuffer()))
  } else {
    img = await loadImage(Buffer.from(String(image).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
  }

  const W = Math.min(Math.max(img.width, 100), 2000)
  const H = Math.round((img.height / img.width) * W)

  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, W, H)

  const fs = Math.max(14, Math.round(W / 26))
  ctx.font = `600 ${fs}px sans-serif`
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = `rgba(255,255,255,${clamp(opacity, 0.1, 1)})`
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'
  ctx.lineWidth = Math.max(2, fs / 8)
  ctx.lineJoin = 'round'

  const m = fs * 0.6
  const label = String(text).slice(0, 60)
  const pos = String(position || 'br').toLowerCase()
  const align = pos.endsWith('l') ? 'left' : 'center'
  const x = align === 'left' ? m : W / 2
  const y = pos.startsWith('t') ? fs + m : H - m

  ctx.textAlign = align
  ctx.strokeText(label, x, y)
  ctx.fillText(label, x, y)

  return canvas.toBuffer('image/png')
}

/* =========================================================
 * 6. AI HUMANIZER (offline, berbasis aturan)
 *    Mengubah teks yang terlalu "robotic" jadi lebih natural.
 *    Tidak memanggil LLM — murni pola teks Indonesia/Inggris.
 * ======================================================= */
const REPLACEMENTS = [
  // formal → natural
  [/\bDengan demikian\b/gi, 'Jadi'],
  [/\bOleh karena itu\b/gi, 'Makanya'],
  [/\bSelain itu\b/gi, 'Oh iya'],
  [/\bTidak hanya itu\b/gi, 'Nggak cuma itu'],
  [/\bSebaliknya\b/gi, 'Sebaliknya'],
  [/\bslinget\b/gi, ''],

  // tanda kata "AI" dalam bahasa Inggris
  [/\bFurthermore\b/gi, 'Selain itu'],
  [/\bMoreover\b/gi, 'Lebih jauh'],
  [/\bIn conclusion\b/gi, 'Jadi intinya'],
  [/\bOverall\b/gi, 'Secara keseluruhan'],
  [/\bIn summary\b/gi, 'Singkatnya'],
  [/\bIt is important to note that\b/gi, 'Perlu dicatat bahwa'],
  [/\bIn today's digital era\b/gi, 'Di zaman digital sekarang'],
  [/\bplays? a crucial role\b/gi, 'sangat penting'],
  [/\bleverage\b/gi, 'pakai'],
  [/\butilize\b/gi, 'gunakan'],
  [/\boptimize\b/gi, 'optimalkan'],
  [/\bimplement\b/gi, 'terapkan'],
  [/\bapproximately\b/gi, 'sekitar'],
  [/\bnumerous\b/gi, 'banyak'],
  [/\bvarious\b/gi, 'berbagai'],
  [/\bsignificant(?:ly)?\b/gi, 'signifikan'],
  [/\bendeavor\b/gi, 'usaha'],
  [/\bfacilitate\b/gi, 'mempermudah'],
  [/\bcrucial\b/gi, 'penting'],
  [/\bessential\b/gi, 'penting'],
  [/\bcomprehensive\b/gi, 'lengkap'],
  [/\binnovative\b/gi, 'innovatif'],
  [/\brevolutionary\b/gi, 'revolusioner'],
  [/\bseamless(?:ly)?\b/gi, 'mulus'],
  [/\brobust\b/gi, 'kuat'],
  [/\bdelve\b/gi, 'mendalami'],
  [/\bpivotal\b/gi, 'kunci'],
  [/\bmyriad\b/gi, 'banyak'],
  [/\bholistic\b/gi, 'menyeluruh'],
  [/\bsynergy\b/gi, 'sinergi'],
  [/\bparadigm\b/gi, 'alur'],

  // pengulangan
  [/\b(\w+)\s+\1\b/gi, '$1'],
  [/!{2,}/g, '!'],
  [/\?{2,}/g, '?'],
]

/** Kalimat yang terlalu "datar" → dibuat lebih hidup */
function addVariety(text) {
  let out = text
  // ganti "Yang" di awal kalimat kadang dengan " yang"
  out = out.replace(/(^|[.!?]\s+)Yang\b/g, '$1Yang')
  return out
}

export function humanize(text, { mode = 'indo' } = {}) {
  let src = String(text || '').trim()
  if (!src) throw new Error('Parameter "text" wajib diisi.')
  if (src.length > 20000) throw new Error('Teks terlalu panjang (maks 20.000 karakter).')

  const before = src

  // 1) pola khas bahasa Indonesia
  if (mode === 'indo') {
    src = src
      .replace(/\b(?:Kullan|Using)\b/gi, 'Pakai')
      .replace(/\b(?:dengan|menggunakan)\s+cara\s+/gi, 'lewat ')
      .replace(/\b(?:adalah|merupakan)\b/gi, 'itu')
      .replace(/\b(?:sangat|sekali)\s+(\w+)/gi, '$1 banget')
      .replace(/\b(?:yaitu|namun)\s+/gi, 'tapi ')
      .replace(/\b(?:jika|bila|apabila)\b/gi, 'kalau')
      .replace(/\b(?:kitchen|present)\b/gi, 'ada')
      .replace(/\b(?:maka|oleh karena itu)\b/gi, 'jadi')
  }

  for (const [re, to] of REPLACEMENTS) {
    src = src.replace(re, typeof to === 'string' ? to : '$1')
  }

  src = addVariety(src)
  src = src.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  // hitung perubahan
  const words = before.trim().split(/\s+/).filter(Boolean).length
  const changed = before !== src

  return {
    status: true,
    text: src,
    original_length: before.length,
    result_length: src.length,
    words,
    changed,
    mode,
  }
}

/* =========================================================
 * Helper
 * ======================================================= */
function clamp(n, min, max) {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.min(Math.max(v, min), max)
}

export default {
  brat,
  bratVideo,
  iphoneQuote,
  meme,
  watermark,
  humanize,
}
