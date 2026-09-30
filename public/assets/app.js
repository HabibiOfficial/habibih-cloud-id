/* =========================================================
   HABI API — Frontend helpers
   ========================================================= */

/* Konfigurasi diambil dari /config, fallback ke default */
const DEFAULT_CONFIG = {
  name: 'HABI API',
  tagline: 'Downloader & Tools REST API',
  owner: 'Habibih Cloud Official ID',
  wa: '6285181576338',
  website: 'https://habibi-store.pages.dev',
  support: '6285181576338',
  group: 'https://chat.whatsapp.com/L8UUutSeDK68LsHf0SXekh',
  quota: '25 req/hari',
  baseUrl: `${location.origin}`,
}

let CFG = { ...DEFAULT_CONFIG }

async function loadConfig() {
  try {
    const res = await fetch('/config', { headers: { Accept: 'application/json' } })
    if (res.ok) CFG = { ...CFG, ...(await res.json()) }
  } catch { /* pakai default */ }
  applyConfig()
}

function applyConfig() {
  document.querySelectorAll('[data-cfg="baseUrl"]').forEach(el => { el.textContent = CFG.baseUrl })
  document.querySelectorAll('[data-cfg="wa"]').forEach(el => { el.href = `https://wa.me/${CFG.support}` })
  document.querySelectorAll('[data-cfg="quota"]').forEach(el => { el.textContent = CFG.quota })
  document.title = `${CFG.name} — ${CFG.tagline}`
}

/* Toast ------------------------------------------------- */
let toastTimer
function toast(msg) {
  let el = document.querySelector('.toast')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  requestAnimationFrame(() => el.classList.add('show'))
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200)
}

/* Copy ke clipboard ------------------------------------- */
async function copyText(text, label = 'Disalin!') {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* abaikan */ }
    ta.remove()
  }
  toast(label)
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]')
  if (btn) copyText(btn.dataset.copy, btn.dataset.copyLabel || 'Disalin ke clipboard!')

  const tab = e.target.closest('.tab')
  if (tab) {
    const group = tab.closest('.code')
    group.querySelectorAll('.tab').forEach(t => t.classList.remove('on'))
    tab.classList.add('on')
    group.querySelectorAll('pre').forEach(p => { p.hidden = p.dataset.lang !== tab.dataset.lang })
  }
})

/* Syntax highlight sederhana untuk JSON ----------------- */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(json) {
  return esc(json)
    .replace(/&quot;([^&]*?)&quot;(\s*:)/g, '<span class="k">"$1"</span>$2')
    .replace(/:\s*&quot;(.*?)&quot;/g, ': <span class="s">"$1"</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="n">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="b">$1</span>')
}

/* Playground tester ------------------------------------- */
function initTester() {
  const form = document.getElementById('t-form')
  if (!form) return

  const sel = form.querySelector('#t-ep')
  const input = form.querySelector('#t-input')
  const out = document.getElementById('t-out')
  const key = form.querySelector('#t-key')

  // Simpan API key user
  try { const saved = localStorage.getItem('habi_key'); if (saved) key.value = saved } catch {}
  key?.addEventListener('input', () => {
    try { localStorage.setItem('habi_key', key.value) } catch {}
  })

  // Ganti label input sesuai endpoint
  const HINTS = {
    '/api/ytmp3': 'https://youtube.com/watch?v=...',
    '/api/ytmp4': 'https://youtube.com/watch?v=...',
    '/api/info': 'https://youtube.com/watch?v=...',
    '/api/direct': 'https://youtube.com/watch?v=...',
    '/api/tiktok': 'https://www.tiktok.com/@user/video/...',
    '/api/tiktok-audio': 'https://www.tiktok.com/@user/video/...',
    '/api/facebook': 'https://www.facebook.com/watch/?v=...',
    '/api/instagram': 'https://www.instagram.com/p/...',
    '/api/file': 'https://contoh.com/file.pdf',
    '/api/ocr': 'https://contoh.com/foto.jpg',
    '/api/translate': 'Halo dunia',
    '/api/tts': 'Halo dunia',
    '/api/ssweb': 'https://example.com',
    '/api/webfetch': 'https://example.com',
    '/api/lirik': '-judul lagu',
    '/api/phonespecs': 'iPhone 15 Pro',
  }
  const updateHint = () => {
    input.placeholder = HINTS[sel.value] || 'https://...'
    input.dataset.param = sel.dataset.param || 'url'
  }
  sel.addEventListener('change', updateHint)
  updateHint()

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const val = input.value.trim()
    if (!val) return toast('Isi parameter dulu!')

    const param = input.dataset.param || 'url'
    const extra = sel.dataset.extra || ''
    const apiKey = key.value.trim()
    const url = `${CFG.baseUrl}${sel.value}${sel.value.includes('?') ? '&' : '?'}${param}=${encodeURIComponent(val)}${extra}${apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : ''}`

    out.textContent = 'Meminta…'
    try {
      const res = await fetch(url)
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('json')) {
        const body = await res.text()
        out.innerHTML = highlight(body)
      } else {
        out.textContent = `[${res.status}] Respons non-JSON (${ct || 'unknown'})\nURL: ${url}`
      }
    } catch (err) {
      out.textContent = `Gagal: ${err.message}`
    }
  })
}

/* Register API key -------------------------------------- */
function initRegister() {
  const form = document.getElementById('reg-form')
  if (!form) return
  const name = form.querySelector('#reg-name')
  const out = document.getElementById('reg-out')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    out.textContent = 'Mendaftarkan…'
    try {
      const res = await fetch(`${CFG.baseUrl}/api/register?note=${encodeURIComponent(name.value.trim() || 'anon')}`)
      out.textContent = await res.text()
    } catch (err) {
      out.textContent = `Gagal: ${err.message}`
    }
  })
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig()
  initTester()
  initRegister()
})
