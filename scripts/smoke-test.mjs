#!/usr/bin/env node
/**
 * =========================================================
 *  Smoke test — cek semua endpoint HABI API
 *
 *  Cara pakai:
 *    node scripts/smoke-test.mjs                       (produksi)
 *    node scripts/smoke-test.mjs http://127.0.0.1:8080 ( lokal)
 *    API_KEY=HABI-XXXX node scripts/smoke-test.mjs     ( pakai key tertentu)
 *
 *  Exit code 0 = semua lolos, 1 = ada yang gagal.
 * =========================================================
 */

const BASE = (process.argv[2] || process.env.BASE_URL || 'https://api.habibicloudserver.dpdns.org').replace(/\/+$/, '')
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS) || 90000

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

/* ---------------------------------------------------------
 * Daftar endpoint
 *
 * type: 'json'  → diharapkan application/json
 *       'file'  → diharapkan file biner (png/webp/mp4)
 * wajib: true   → harus punya API key
 * ------------------------------------------------------- */
const TESTS = [
  // ── Halaman & sistem ──
  { name: '/', path: '/', type: 'file', wajib: false, expect: 'text/html' },
  { name: '/docs', path: '/docs', type: 'file', wajib: false, expect: 'text/html' },
  { name: '/pricing', path: '/pricing', type: 'file', wajib: false, expect: 'text/html' },
  { name: '/healthz', path: '/healthz', type: 'json', wajib: false },

  // ── Image tools ──
  { name: '/api/brat', path: '/api/brat?text=Halo%20HABI', type: 'file', wajib: true, expect: 'image/png' },
  { name: '/api/bratvid', path: '/api/bratvid?text=Halo%20HABI&duration=1', type: 'file', wajib: true, expect: 'video/mp4', slow: true },
  { name: '/api/iqc', path: '/api/iqc?text=Halo&time=2%3A21', type: 'file', wajib: true, expect: 'image/png' },
  { name: '/api/iqc (menu=false)', path: '/api/iqc?text=Halo&menu=false', type: 'file', wajib: true, expect: 'image/png' },
  { name: '/api/meme', path: '/api/meme?image=https://picsum.photos/seed/habi/600/400&top=atas&bottom=bawah', type: 'file', wajib: true, expect: 'image/png' },
  { name: '/api/watermark', path: '/api/watermark?image=https://picsum.photos/seed/habi2/600/400&text=HABI', type: 'file', wajib: true, expect: 'image/png' },
  { name: '/api/humanizer', path: '/api/humanizer?text=It%20is%20important%20to%20note%20that', type: 'json', wajib: true },

  // ── Downloader native ──
  { name: '/api/ytsearch', path: '/api/ytsearch?q=rizky%20janaka&limit=3', type: 'json', wajib: true, slow: true },
  { name: '/api/ytinfo', path: '/api/ytinfo?url=https://youtu.be/dQw4w9WgXcQ', type: 'json', wajib: true, slow: true },
  { name: '/api/ytthumb', path: '/api/ytthumb?id=dQw4w9WgXcQ', type: 'json', wajib: true },
  { name: '/api/spotify', path: '/api/spotify?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', type: 'json', wajib: true, slow: true },

  // ── Studio ──
  { name: '/api/resolve', path: '/api/resolve?url=https://www.tiktok.com/@scout2015/video/6718335390845095173', type: 'json', wajib: true, slow: true },
  { name: '/api/detect', path: '/api/detect?url=https://vm.tiktok.com/XXXX/', type: 'json', wajib: true },
  { name: '/api/sticker', path: '/api/sticker?image=https://picsum.photos/seed/habi3/400/400', type: 'file', wajib: true, expect: 'image/webp' },
  { name: '/api/welcome', path: '/api/welcome?name=Uji&group=Grup%20Tes&accent=green', type: 'file', wajib: true, expect: 'image/png' },
  { name: '/api/reply (v1)', path: '/api/reply?variant=1&text=Uji&name=HABI', type: 'file', wajib: true, expect: 'image/png' },
  { name: '/api/reply (v5)', path: '/api/reply?variant=5&text=Uji&name=HABI', type: 'file', wajib: true, expect: 'image/png' },
  { name: '/api/reply/variants', path: '/api/reply/variants', type: 'json', wajib: true },

  // ── Auth gate: harus 401 tanpa key ──
  { name: 'auth: /api/brat tanpa key', path: '/api/brat?text=x', type: 'json', expectStatus: 401, tanpaKey: true },
  { name: 'auth: /api/reply tanpa key', path: '/api/reply?text=x', type: 'json', expectStatus: 401, tanpaKey: true },
  { name: 'auth: /api/ytsearch tanpa key', path: '/api/ytsearch?q=x', type: 'json', expectStatus: 401, tanpaKey: true },

  // ── SSRF: harus ditolak ──
  { name: 'ssrf: /api/meme localhost', path: '/api/meme?image=http://127.0.0.1/x.png', type: 'json', wajib: true, expectStatus: 400 },
  { name: 'ssrf: /api/watermark 169.254', path: '/api/watermark?image=http://169.254.169.254/latest', type: 'json', wajib: true, expectStatus: 400 },
  { name: 'ssrf: /api/sticker 10.x', path: '/api/sticker?image=http://10.0.0.5/a.png', type: 'json', wajib: true, expectStatus: 400 },
  { name: 'ssrf: /api/welcome file://', path: '/api/welcome?avatar=file:///etc/passwd', type: 'json', wajib: true, expectStatus: 400 },
]

/* ---------------------------------------------------------
 * Penerjemah
 * ------------------------------------------------------- */
const results = []

async function run(test) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), test.slow ? TIMEOUT : 45000)

  let url = `${BASE}${test.path}`
  if (test.wajib && !test.tanpaKey && KEY) {
    url += `${url.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(KEY)}`
  }
  if (test.wajib && !test.tanpaKey && !KEY) {
    results.push({ ...test, ok: false, ms: 0, note: 'API_KEY belum di-set' })
    return
  }

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'HABI-SmokeTest/1.0' },
    })
    const ct = res.headers.get('content-type') || ''
    const ms = Date.now() - started

    if (test.expectStatus) {
      const ok = res.status === test.expectStatus
      const body = ok ? '' : ` (dapat ${res.status})`
      results.push({ ...test, ok, ms, note: body })
      return
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      results.push({ ...test, ok: false, ms, note: `HTTP ${res.status} ${text.slice(0, 90)}` })
      return
    }

    if (test.type === 'json' && !ct.includes('json')) {
      results.push({ ...test, ok: false, ms, note: `content-type bukan JSON (${ct})` })
      return
    }
    if (test.expect && !ct.includes(test.expect)) {
      results.push({ ...test, ok: false, ms, note: `content-type ${ct}, harap ${test.expect}` })
      return
    }
    if (test.type === 'file' && !test.expect && ct.includes('text/html')) {
      results.push({ ...test, ok: false, ms, note: 'balas HTML, kemungkinan halaman error' })
      return
    }

    // Untuk JSON, pastikan status:true kalau ada field itu
    if (test.type === 'json' && !test.tanpaKey) {
      const body = await res.json().catch(() => null)
      if (body && 'status' in body && body.status !== true) {
        results.push({ ...test, ok: false, ms, note: `status:false — ${body.error || ''}` })
        return
      }
    }

    results.push({ ...test, ok: true, ms })
  } catch (err) {
    const ms = Date.now() - started
    const msg = err?.name === 'AbortError' ? `timeout >${test.slow ? TIMEOUT : 45000}ms` : err.message
    results.push({ ...test, ok: false, ms, note: msg })
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------------------------------------------------
 * Main
 * ------------------------------------------------------- */
console.log(C.bold(`\n  HABI API — smoke test`))
console.log(C.dim(`  target : ${BASE}`))

let KEY = process.env.API_KEY || ''

if (!KEY) {
  process.stdout.write(C.dim('  ambil API key dari /api/register … '))
  try {
    const res = await fetch(`${BASE}/api/register`, { signal: AbortSignal.timeout(20000) })
    const body = await res.json()
    KEY = body.apikey || ''
    console.log(KEY ? C.green('ok') : C.red('gagal'))
  } catch (err) {
    console.log(C.red(`gagal — ${err.message}`))
  }
} else {
  console.log(C.dim(`  API key dari environment`))
}
console.log()

for (const test of TESTS) {
  process.stdout.write(C.dim('  … '))
  await run(test)
  const r = results[results.length - 1]
  const label = r.name.padEnd(30)
  const timing = `${String(r.ms).padStart(6)}ms`
  if (r.ok) {
    console.log(`\r  ${C.green('✓')} ${label} ${C.dim(timing)}      `)
  } else {
    console.log(`\r  ${C.red('✗')} ${label} ${C.dim(timing)} ${C.red(r.note || '')}`)
  }
}

const pass = results.filter((r) => r.ok).length
const fail = results.length - pass
const slowest = results.reduce((a, b) => (b.ms > a.ms ? b : a), results[0] || { ms: 0, name: '-' })

console.log()
if (fail === 0) {
  console.log(`  ${C.green('✓')} ${pass}/${results.length} lolos` + C.dim(`  (terlama: ${slowest.name} ${slowest.ms}ms)`))
  console.log()
  process.exit(0)
} else {
  console.log(`  ${C.red('✗')} ${fail} gagal, ${pass} lolos dari ${results.length}`)
  console.log(C.dim(`  terlama: ${slowest.name} ${slowest.ms}ms`))
  console.log()
  process.exit(1)
}
