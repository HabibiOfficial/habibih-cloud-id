#!/usr/bin/env node
/**
 * Audit semua endpoint yang terdaftar di landing page —
 * cek mana yang benar-benar hidup, mana yang error.
 */
const BASE = (process.argv[2] || 'https://api.habibicloudserver.dpdns.org').replace(/\/+$/, '')
const TIMEOUT = Number(process.env.AUDIT_TIMEOUT_MS) || 120000

const IMG = 'https://picsum.photos/seed/a/500/300'
const YT = 'https://youtu.be/dQw4w9WgXcQ'
const TT = 'https://www.tiktok.com/@scout2015/video/6718335390845095173'
const FB = 'https://www.facebook.com/watch/?v=10153231379946729'

const EP = [
  // [label, path, slow?]
  ['/api/brat', '/api/brat?text=hai', 0],
  ['/api/bratvid', '/api/bratvid?text=hai&duration=1', 1],
  ['/api/iqc', '/api/iqc?text=Halo', 0],
  ['/api/meme', `/api/meme?image=${IMG}&top=a&bottom=b`, 0],
  ['/api/watermark', `/api/watermark?image=${IMG}&text=x`, 0],
  ['/api/humanizer', '/api/humanizer?text=It+is+important', 0],

  ['/api/ytsearch', '/api/ytsearch?q=test&limit=2', 1],
  ['/api/ytinfo', `/api/ytinfo?url=${YT}`, 1],
  ['/api/ytthumb', '/api/ytthumb?id=dQw4w9WgXcQ', 0],
  ['/api/spotify', '/api/spotify?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 1],

  ['/api/ytmp3', `/api/ytmp3?url=${YT}`, 1],
  ['/api/ytmp4', `/api/ytmp4?url=${YT}`, 1],
  ['/api/info', `/api/info?url=${YT}`, 1],
  ['/api/direct', `/api/direct?url=${TT}`, 1],
  ['/api/tiktok', `/api/tiktok?url=${TT}`, 1],
  ['/api/tiktok-audio', `/api/tiktok-audio?url=${TT}`, 1],
  ['/api/facebook', `/api/facebook?url=${FB}`, 1],
  ['/api/instagram', '/api/instagram?url=https://www.instagram.com/p/CUbHfhpswxt/', 1],
  ['/api/file', '/api/file?url=https://www.google.com/robots.txt', 0],

  ['/api/ocr', `/api/ocr?url=${IMG}`, 1],
  ['/api/translate', '/api/translate?text=hello&to=id', 0],
  ['/api/tts', '/api/tts?text=halo+dunia', 1],
  ['/api/ssweb', '/api/ssweb?url=https://example.com', 1],
  ['/api/webfetch', '/api/webfetch?url=https://example.com', 1],
  ['/api/lirik', '/api/lirik?q=Indonesia+Raya', 1],
  ['/api/phonespecs', '/api/phonespecs?q=iPhone+15+Pro', 1],
  ['/api/phonecompare', '/api/phonecompare?a=iPhone+15+Pro&b=Samsung+S23', 1],
  ['/api/removebg', `/api/removebg?url=${IMG}`, 1],
  ['/api/pdfcompress', '/api/pdfcompress?url=https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/basicapi.pdf', 1],

  ['/api/resolve', `/api/resolve?url=${TT}`, 1],
  ['/api/detect', '/api/detect?url=https://vm.tiktok.com/X/', 0],
  ['/api/sticker', `/api/sticker?image=${IMG}`, 0],
  ['/api/welcome', '/api/welcome?name=Uji', 0],
  ['/api/reply', '/api/reply?text=Uji', 0],
  ['/api/reply/variants', '/api/reply/variants', 0],
]

const reg = await fetch(`${BASE}/api/register`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json())
const KEY = reg.apikey || ''
console.log(`\n  audit: ${BASE}`)
console.log(`  key   : ${KEY ? KEY.slice(0, 10) + '…' : 'GAGAL ambil'}\n`)

const rows = []
for (const [label, path, slow] of EP) {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${BASE}${path}${KEY ? sep + 'apikey=' + encodeURIComponent(KEY) : ''}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), slow ? TIMEOUT : 45000)
  const t0 = Date.now()
  let verdict = '?', detail = ''
  try {
    const res = await fetch(url, { signal: ctl.signal })
    const ct = res.headers.get('content-type') || ''
    const ms = Date.now() - t0
    if (res.ok) {
      if (ct.includes('json')) {
        const body = await res.json().catch(() => null)
        if (body && body.status === false) {
          verdict = 'BROKEN'
          detail = String(body.error || 'status:false').replace(/\s+/g, ' ').slice(0, 58)
        } else {
          verdict = 'OK'
          detail = `json ${ms}ms`
        }
      } else if (ct.includes('text/html')) {
        verdict = 'BROKEN'
        detail = 'balas HTML (kemungkinan halaman error)'
      } else {
        verdict = 'OK'
        detail = `${ct.split(';')[0]} ${ms}ms`
      }
    } else {
      verdict = 'BROKEN'
      const txt = await res.text().catch(() => '')
      detail = `HTTP ${res.status} ${txt.replace(/\s+/g, ' ').slice(0, 52)}`
    }
  } catch (e) {
    verdict = e?.name === 'AbortError' ? 'TIMEOUT' : 'ERROR'
    detail = e.message.slice(0, 58)
  } finally {
    clearTimeout(timer)
  }
  rows.push({ label, verdict, detail })
  const icon = verdict === 'OK' ? '\x1b[32m✓\x1b[0m' : verdict === 'TIMEOUT' ? '\x1b[33m⧗\x1b[0m' : '\x1b[31m✗\x1b[0m'
  console.log(`  ${icon} ${label.padEnd(22)} \x1b[2m${detail}\x1b[0m`)
}

const broken = rows.filter((r) => r.verdict !== 'OK')
console.log()
console.log(`  \x1b[32m✓ ${rows.length - broken.length}/${rows.length} hidup\x1b[0m`)
if (broken.length) {
  console.log(`  \x1b[31m✗ ${broken.length} bermasalah:\x1b[0m`)
  for (const b of broken) console.log(`      ${b.label.padEnd(22)} ${b.detail}`)
}
console.log()
process.exit(broken.length ? 1 : 0)
