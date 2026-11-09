/**
 * Login page rendering and login/logout path handling for the proxy bridge.
 *
 * @module @painclown/dsh-proxy-bridge/login
 */

import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'

/** The bridge's login path. */
export const LOGIN_PATH = '/__bridge_login'
/** The bridge's logout path. */
export const LOGOUT_PATH = '/__bridge_logout'

/** Escape a string for safe inclusion in an HTML attribute. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Render the login page.
 */
export function renderLoginPage(error?: string): string {
  const errHtml = error
    ? `<div class="alert" role="alert">${escapeHtml(error)}</div>`
    : ''
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>DSH Bridge</title>
<style>
:root {
  --color-bg-canvas: #f0f2f5;
  --color-bg-surface: #ffffff;
  --color-bg-subtle: #f5f7fa;
  --color-text-primary: #1a1a2e;
  --color-text-secondary: #5a6072;
  --color-text-tertiary: #9ca3b0;
  --color-border-subtle: rgba(226, 232, 240, 0.6);
  --color-border-default: #dfe3ea;
  --color-border-focus: #3b82f6;
  --color-brand-primary: #2563eb;
  --color-brand-hover: #1d4ed8;
  --color-brand-active: #1e40af;
  --color-brand-soft: rgba(37, 99, 235, 0.08);
  --color-status-danger: #dc2626;
  --color-status-danger-bg: #fef2f2;
  --shadow-card: 0 2px 8px rgba(16, 24, 40, 0.04), 0 8px 24px rgba(16, 24, 40, 0.06);
  --radius-card: 16px;
  --radius-input: 8px;
  --radius-btn: 8px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg-canvas: #0d1117;
    --color-bg-surface: #161b22;
    --color-bg-subtle: #1c2128;
    --color-text-primary: #e6edf3;
    --color-text-secondary: #8b949e;
    --color-text-tertiary: #6e7681;
    --color-border-subtle: rgba(48, 54, 61, 0.6);
    --color-border-default: #30363d;
    --color-border-focus: #58a6ff;
    --color-brand-primary: #3b82f6;
    --color-brand-hover: #2563eb;
    --color-brand-active: #1d4ed8;
    --color-brand-soft: rgba(59, 130, 246, 0.12);
    --color-status-danger: #f87171;
    --color-status-danger-bg: rgba(220, 38, 38, 0.15);
    --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.4);
  }
}
* { box-sizing: border-box; }
html { height: 100%; }
body {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0;
  padding: 16px;
  background: var(--color-bg-canvas);
  background-image: radial-gradient(ellipse 80% 60% at 50% 0%, var(--color-brand-soft) 0%, transparent 70%);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.card {
  background: var(--color-bg-surface);
  padding: 40px 36px 32px;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  width: min(380px, 100%);
  border: 0.5px solid var(--color-border-subtle);
  animation: card-in 0.35s cubic-bezier(0.21, 1.02, 0.73, 1) both;
}
@keyframes card-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@media (max-width: 420px) {
  body { padding: 12px; }
  .card { padding: 28px 24px 24px; }
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}
.brand-icon {
  width: 44px;
  height: 44px;
  background: linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-hover) 100%);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
}
.brand-icon svg {
  width: 22px;
  height: 22px;
  color: #fff;
}
h1 {
  font-size: 22px;
  line-height: 30px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  text-align: center;
  letter-spacing: -0.01em;
}
.subtitle {
  font-size: 14px;
  line-height: 22px;
  color: var(--color-text-secondary);
  margin: 6px 0 0;
  text-align: center;
}
.alert {
  background: var(--color-status-danger-bg);
  color: var(--color-status-danger);
  font-size: 13px;
  line-height: 20px;
  padding: 10px 14px;
  border-radius: var(--radius-input);
  margin-bottom: 20px;
  border: 0.5px solid rgba(220, 38, 38, 0.15);
}
form { margin: 0; }
.field {
  margin-bottom: 20px;
}
label {
  display: block;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 8px;
}
input[type="password"] {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-input);
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-size: 15px;
  line-height: 22px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
input[type="password"]::placeholder {
  color: var(--color-text-tertiary);
}
input[type="password"]:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.btn-primary {
  width: 100%;
  height: 44px;
  padding: 0 16px;
  background: var(--color-brand-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-btn);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
  letter-spacing: 0.01em;
}
.btn-primary:hover {
  background: var(--color-brand-hover);
}
.btn-primary:active {
  background: var(--color-brand-active);
  transform: scale(0.985);
}
.btn-primary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
}
.footer {
  margin-top: 28px;
  text-align: center;
  font-size: 12px;
  line-height: 18px;
  color: var(--color-text-tertiary);
}
.version-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--color-brand-soft);
  color: var(--color-brand-primary);
  font-family: ui-monospace, "SF Mono", "Cascadia Code", monospace;
  letter-spacing: 0.04em;
  vertical-align: middle;
  margin-left: 6px;
}
</style>
</head>
<body>
<div class="card">
  <div class="brand">
    <div class="brand-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    </div>
    <div>
      <h1>DSH Bridge <span class="version-badge">v2.0</span></h1>
      <p class="subtitle">代理桥接服务 · 输入密码后访问</p>
    </div>
  </div>
  ${errHtml}
  <form method="POST" action="${LOGIN_PATH}">
    <div class="field">
      <label for="password">访问密码</label>
      <input type="password" id="password" name="password" placeholder="••••••••" autofocus required>
    </div>
    <button type="submit" class="btn-primary">登 录</button>
  </form>
  <div class="footer">DeepSeek Harness Proxy Bridge</div>
</div>
</body>
</html>`
}

/** Serve the GET login page. */
export function serveLoginGet(res: ServerResponse, extraHeaders: OutgoingHttpHeaders = {}): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(renderLoginPage())
}

/** Serve a login error page. */
export function serveLoginError(res: ServerResponse, error: string, extraHeaders: OutgoingHttpHeaders = {}): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(renderLoginPage(error))
}

/** Serve the rate-limit response. */
export function serveRateLimited(res: ServerResponse, extraHeaders: OutgoingHttpHeaders = {}): void {
  res.writeHead(429, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end('Too many login attempts. Please try again later.')
}

/** Read a request body up to a byte ceiling, rejecting anything larger. */
export function readBody(req: IncomingMessage, maxBytes: number, res: ServerResponse): Promise<string | undefined> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        res.writeHead(413)
        res.end()
        resolve(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', () => {
      res.writeHead(400)
      res.end()
      resolve(undefined)
    })
  })
}
