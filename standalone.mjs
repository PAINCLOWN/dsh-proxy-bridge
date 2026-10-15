#!/usr/bin/env node
/**
 * Standalone DSH proxy bridge — minimal reverse proxy with auth.
 * Listens on 0.0.0.0:3083, forwards to 127.0.0.1:3080.
 */
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PORT = 3083
const DSH_PORT = 3080
const DSH_HOST = '127.0.0.1'
const PASSWORD = 'dsh2026'
const DSH_SECRET = 'vGIxivMEJblP1teRqVymk6sefy7wHMzxds9T0Unv6rE'
const COOKIE_NAME = 'dsh-bridge-session'
const COOKIE_MAX_AGE_DAYS = 7
const STATE_PATH = path.join(os.homedir(), '.dsh', 'proxy-bridge', 'state.json')

// --- State ---
let state
try {
  state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
} catch {
  state = { cookieSecret: crypto.randomBytes(32).toString('base64'), sessionEpoch: 1 }
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 })
}

function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 })
}

// --- Cookie helpers ---
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function base64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/')
  s += '='.repeat((4 - s.length % 4) % 4)
  return Buffer.from(s, 'base64')
}
function cookieValue(header, name) {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

// --- DSH auth cookie ---
function dshCookieName(authority) {
  return 'dsh-auth-' + base64url(crypto.createHash('sha256').update(authority).digest())
}
function generateDshCookie() {
  const authority = `${DSH_HOST}:${DSH_PORT}`
  const secret = base64urlDecode(DSH_SECRET)
  const payload = {
    version: 1,
    authority,
    issuedAt: Date.now(),
    expiresAt: Date.now() + COOKIE_MAX_AGE_DAYS * 86400_000,
  }
  const body = base64url(Buffer.from(JSON.stringify(payload)))
  const hmac = crypto.createHmac('sha256', secret).update(body).digest()
  const value = `v1.${body}.${base64url(hmac)}`
  return `${dshCookieName(authority)}=${value}`
}

// --- Session cookie ---
function signSessionCookie(sid) {
  const payload = { sid, epoch: state.sessionEpoch, exp: Date.now() + COOKIE_MAX_AGE_DAYS * 86400_000 }
  const payloadStr = base64url(Buffer.from(JSON.stringify(payload)))
  const hmac = crypto.createHmac('sha256', base64urlDecode(state.cookieSecret)).update(payloadStr).digest()
  return `${payloadStr}.${base64url(hmac)}`
}
function verifySessionCookie(value) {
  if (!value) return null
  const [payloadStr, sigStr] = value.split('.')
  if (!payloadStr || !sigStr) return null
  const expected = crypto.createHmac('sha256', base64urlDecode(state.cookieSecret)).update(payloadStr).digest()
  const actual = base64urlDecode(sigStr)
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null
  try {
    const payload = JSON.parse(base64urlDecode(payloadStr).toString('utf8'))
    if (payload.epoch !== state.sessionEpoch) return null
    if (payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

// --- Rate limiter ---
const rateBuckets = new Map()
function rateLimit(ip) {
  const now = Date.now()
  let bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.start > 60_000) {
    bucket = { start: now, count: 0 }
    rateBuckets.set(ip, bucket)
  }
  bucket.count++
  return bucket.count <= 5
}

// --- Header rewriting ---
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding'])
const FORWARDING_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto', 'x-real-ip']

function buildUpstreamHeaders(headers, keepUpgrade) {
  const out = { ...headers }
  out.host = `${DSH_HOST}:${DSH_PORT}`
  if (typeof out.origin === 'string') out.origin = `http://${DSH_HOST}:${DSH_PORT}`
  delete out['proxy-connection']
  for (const name of HOP_BY_HOP) {
    if (name === 'connection' || name === 'upgrade') {
      if (!keepUpgrade) delete out[name]
    } else {
      delete out[name]
    }
  }
  for (const name of FORWARDING_HEADERS) delete out[name]
  return out
}

// --- Login page ---
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0f0f1a">
<title>DSH Bridge</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f0f1a;--surface:#1a1a2e;--surface2:#16213e;
  --accent:#e94560;--accent-hover:#c73650;--accent-glow:rgba(233,69,96,.25);
  --text:#f0f0f5;--text-dim:#8888a0;--border:#2a2a4a;
  --radius:14px;--radius-sm:10px;
}
html{height:100%}
body{
  min-height:100%;min-height:100dvh;
  display:flex;align-items:center;justify-content:center;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  background:var(--bg);color:var(--text);
  padding:16px;
  -webkit-tap-highlight-color:transparent;
}
/* subtle animated gradient bg */
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;
  background:
    radial-gradient(ellipse 80% 60% at 20% 20%,rgba(233,69,96,.08),transparent),
    radial-gradient(ellipse 60% 50% at 80% 80%,rgba(78,70,214,.08),transparent);
}
.card{
  position:relative;width:100%;max-width:380px;
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--radius);
  padding:2.5rem 2rem;
  box-shadow:0 8px 40px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.03) inset;
}
/* logo / icon */
.logo{
  width:52px;height:52px;margin:0 auto 1.25rem;
  border-radius:14px;
  background:linear-gradient(135deg,var(--accent),#4e46d6);
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 20px var(--accent-glow);
}
.logo svg{width:28px;height:28px;fill:#fff}
h1{
  font-size:1.35rem;font-weight:700;text-align:center;
  letter-spacing:-.02em;margin-bottom:.35rem;
}
.sub{
  text-align:center;color:var(--text-dim);font-size:.875rem;
  margin-bottom:1.75rem;line-height:1.4;
}
/* form */
.field{position:relative;margin-bottom:1rem}
.field input{
  width:100%;height:48px;
  padding:0 44px 0 14px;
  border:1.5px solid var(--border);border-radius:var(--radius-sm);
  background:var(--bg);color:var(--text);
  font-size:1rem;outline:none;
  transition:border-color .2s,box-shadow .2s;
  -webkit-appearance:none;appearance:none;
}
.field input::placeholder{color:var(--text-dim)}
.field input:focus{
  border-color:var(--accent);
  box-shadow:0 0 0 3px var(--accent-glow);
}
/* eye toggle */
.eye{
  position:absolute;right:6px;top:50%;transform:translateY(-50%);
  width:36px;height:36px;
  display:flex;align-items:center;justify-content:center;
  background:none;border:none;cursor:pointer;
  color:var(--text-dim);border-radius:8px;
  transition:color .15s;
}
.eye:hover,.eye:active{color:var(--text)}
.eye svg{width:20px;height:20px;fill:currentColor}
/* submit */
.btn{
  width:100%;height:48px;margin-top:.25rem;
  border:none;border-radius:var(--radius-sm);
  background:var(--accent);color:#fff;
  font-size:1rem;font-weight:600;cursor:pointer;
  transition:background .2s,transform .1s,box-shadow .2s;
  box-shadow:0 2px 12px var(--accent-glow);
  display:flex;align-items:center;justify-content:center;gap:8px;
}
.btn:hover{background:var(--accent-hover)}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.6;cursor:not-allowed}
/* spinner */
.spinner{
  width:18px;height:18px;
  border:2px solid rgba(255,255,255,.3);border-top-color:#fff;
  border-radius:50%;animation:spin .6s linear infinite;
  display:none;
}
@keyframes spin{to{transform:rotate(360deg)}}
.btn.loading .spinner{display:block}
.btn.loading .label{display:none}
/* error */
.err{
  margin-top:.875rem;text-align:center;
  color:var(--accent);font-size:.875rem;
  min-height:1.25em;
  opacity:0;transform:translateY(-4px);
  transition:opacity .25s,transform .25s;
}
.err.show{opacity:1;transform:translateY(0)}
/* footer */
.foot{
  margin-top:1.5rem;text-align:center;
  color:var(--text-dim);font-size:.75rem;
}
/* mobile tweaks */
@media(max-width:400px){
  .card{padding:2rem 1.25rem}
  h1{font-size:1.2rem}
}
@media(min-width:768px){
  .card{padding:3rem 2.5rem}
}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2H11zm0-4V7h2v6h-2z"/></svg>
  </div>
  <h1>DSH Bridge</h1>
  <p class="sub">DeepSeek Harness 反向代理<br>请输入密码以继续</p>
  <form id="f" method="POST" action="/__bridge/login">
    <div class="field">
      <input type="password" name="password" id="pw" placeholder="密码" autofocus required autocomplete="current-password">
      <button type="button" class="eye" id="eye" aria-label="显示密码">
        <svg viewBox="0 0 24 24" id="eyeIcon"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/></svg>
      </button>
    </div>
    <button type="submit" class="btn" id="btn">
      <span class="spinner"></span>
      <span class="label">登 录</span>
    </button>
  </form>
  <div class="err" id="err"></div>
  <div class="foot">DSH Proxy Bridge · v1</div>
</div>
<script>
// password visibility toggle
const eye=document.getElementById('eye'),pw=document.getElementById('pw'),icon=document.getElementById('eyeIcon');
eye.addEventListener('click',()=>{
  const show=pw.type==='password';
  pw.type=show?'text':'password';
  eye.setAttribute('aria-label',show?'隐藏密码':'显示密码');
  icon.innerHTML=show
    ?'<path d="M12 7a5 5 0 105 5 5 5 0 00-5-5zm0 8a3 3 0 113-3 3 3 0 01-3 3zm10-2c-1.73 4.39-6 7.5-11 7.5a11 11 0 01-4.76-1.12l1.4-1.4A8.9 8.9 0 0012 17c4.42 0 8.18-2.61 9.74-6.39l1.26 1.26zM2.21 2.21l1.34 1.34C2.4 4.67 1.21 6.43.5 8.41c1.73 4.39 6 7.5 11 7.5 1.58 0 3.07-.36 4.41-1l1.3 1.3A11.06 11.06 0 0112 21.5c-5 0-9.27-3.11-11-7.5a11.06 11.06 0 013.5-8.49l1.3 1.3A8.97 8.97 0 002.21 2.21z"/>'
    :'<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/>';
});
// form submit with loading state
const form=document.getElementById('f'),btn=document.getElementById('btn');
form.addEventListener('submit',e=>{
  btn.classList.add('loading');btn.disabled=true;
});
// error display
if(location.search.includes('error')){
  const el=document.getElementById('err');
  el.textContent='密码错误，请重试';
  el.classList.add('show');
  pw.focus();
}
</script>
</body>
</html>`

// --- HTTP handler ---
function handleHttp(req, res) {
  const ip = req.socket.remoteAddress || 'unknown'
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  // Login routes
  if (url.pathname === '/__bridge/login' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(LOGIN_HTML)
    return
  }
  if (url.pathname === '/__bridge/login' && req.method === 'POST') {
    if (!rateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'text/plain' })
      res.end('Too many attempts')
      return
    }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const params = new URLSearchParams(body)
      const pw = params.get('password') || ''
      // Simple password check (scrypt hash in state)
      const hash = crypto.scryptSync(pw, 'dsh-bridge', 64).toString('hex')
      if (hash === (state.password?.hash || '')) {
        const sid = crypto.randomBytes(16).toString('hex')
        const cookie = signSessionCookie(sid)
        res.writeHead(302, {
          'Location': '/',
          'Set-Cookie': `${COOKIE_NAME}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_DAYS * 86400}`,
        })
        res.end()
      } else {
        res.writeHead(302, { 'Location': '/__bridge/login?error=1' })
        res.end()
      }
    })
    return
  }
  if (url.pathname === '/__bridge/logout') {
    res.writeHead(302, {
      'Location': '/__bridge/login',
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    })
    res.end()
    return
  }

  // Auth check
  const cookieVal = cookieValue(req.headers.cookie, COOKIE_NAME)
  const session = verifySessionCookie(cookieVal)
  if (!session) {
    res.writeHead(302, { 'Location': '/__bridge/login' })
    res.end()
    return
  }

  // Rewrite /sidebar/api/ → /api/
  let upstreamPath = req.url || '/'
  if (upstreamPath.startsWith('/sidebar/api/')) {
    upstreamPath = upstreamPath.replace('/sidebar/api/', '/api/')
  }

  // Forward to DSH
  const headers = buildUpstreamHeaders(req.headers, false)
  // Inject DSH auth cookie
  const dshCookie = generateDshCookie()
  headers.cookie = headers.cookie ? `${headers.cookie}; ${dshCookie}` : dshCookie

  const proxyReq = http.request({
    host: DSH_HOST,
    port: DSH_PORT,
    method: req.method,
    path: upstreamPath,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res)
  })
  proxyReq.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end(`Bad Gateway: ${e.message}`)
  })
  req.pipe(proxyReq)
}

// --- WebSocket upgrade handler ---
function handleUpgrade(req, socket, head) {
  const ip = req.socket.remoteAddress || 'unknown'
  const cookieVal = cookieValue(req.headers.cookie, COOKIE_NAME)
  const session = verifySessionCookie(cookieVal)
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.end()
    return
  }

  let upstreamPath = req.url || '/'
  if (upstreamPath.startsWith('/sidebar/api/')) {
    upstreamPath = upstreamPath.replace('/sidebar/api/', '/api/')
  }

  // DSH only handles WebSocket upgrades at /api/remote.mux
  // Reject other paths to avoid DSH closing the connection mid-handshake
  const url = new URL(upstreamPath, 'http://x')
  if (url.pathname !== '/api/remote.mux') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    socket.end()
    return
  }

  const headers = buildUpstreamHeaders(req.headers, true)
  const dshCookie = generateDshCookie()
  headers.cookie = headers.cookie ? `${headers.cookie}; ${dshCookie}` : dshCookie

  const rawHeaders = Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\r\n')
  const requestLine = `${req.method || 'GET'} ${upstreamPath} HTTP/1.1\r\n${rawHeaders}\r\n\r\n`

  const upstream = net.connect({ host: DSH_HOST, port: DSH_PORT }, () => {
    upstream.write(requestLine)
    if (head && head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', (e) => {
    socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    socket.end()
  })
  socket.on('error', () => upstream.destroy())
}

// --- Start server ---
const server = http.createServer(handleHttp)
server.on('upgrade', handleUpgrade)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[bridge] listening on 0.0.0.0:${PORT} → ${DSH_HOST}:${DSH_PORT}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[bridge] ${sig}, shutting down…`)
    server.close(() => process.exit(0))
  })
}
