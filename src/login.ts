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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Bridge</title>
<style>
:root {
  --color-bg-canvas: #f8fafc;
  --color-bg-surface: #ffffff;
  --color-bg-subtle: #f1f5f9;
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-tertiary: #94a3b8;
  --color-border-subtle: rgba(226, 232, 240, 0.7);
  --color-border-default: #e2e8f0;
  --color-border-focus: #3b82f6;
  --color-brand-primary: #2563eb;
  --color-brand-hover: #1d4ed8;
  --color-brand-active: #1e40af;
  --color-status-danger: #dc2626;
  --color-status-danger-bg: #fef2f2;
  --shadow-card: 0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 1px 2px -1px rgba(15, 23, 42, 0.04);
  --shadow-dialog: 0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04);
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg-canvas: #0f172a;
    --color-bg-surface: #1e293b;
    --color-bg-subtle: #334155;
    --color-text-primary: #f1f5f9;
    --color-text-secondary: #94a3b8;
    --color-text-tertiary: #64748b;
    --color-border-subtle: rgba(51, 65, 85, 0.7);
    --color-border-default: #334155;
    --color-border-focus: #3b82f6;
    --color-brand-primary: #3b82f6;
    --color-brand-hover: #2563eb;
    --color-brand-active: #1d4ed8;
    --color-status-danger: #f87171;
    --color-status-danger-bg: rgba(220, 38, 38, 0.15);
    --shadow-card: 0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 2px -1px rgba(0, 0, 0, 0.3);
    --shadow-dialog: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
  }
}
* { box-sizing: border-box; }
body {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  margin: 0;
  background: var(--color-bg-canvas);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
}
.card {
  background: var(--color-bg-surface);
  padding: 40px;
  border-radius: 12px;
  box-shadow: var(--shadow-dialog);
  width: 360px;
  border: 1px solid var(--color-border-subtle);
}
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
}
.brand-icon {
  width: 28px;
  height: 28px;
  background: var(--color-brand-primary);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-icon svg {
  width: 16px;
  height: 16px;
  color: #fff;
}
h1 {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
  text-align: center;
}
.subtitle {
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
  margin: 0 0 24px;
  text-align: center;
}
.alert {
  background: var(--color-status-danger-bg);
  color: var(--color-status-danger);
  font-size: 13px;
  line-height: 18px;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 16px;
  border: 1px solid rgba(220, 38, 38, 0.12);
}
form { margin: 0; }
.field {
  margin-bottom: 16px;
}
label {
  display: block;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 6px;
}
input[type="password"] {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-size: 14px;
  line-height: 20px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
input[type="password"]::placeholder {
  color: var(--color-text-tertiary);
}
input[type="password"]:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
.btn-primary {
  width: 100%;
  padding: 10px 16px;
  background: var(--color-brand-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover {
  background: var(--color-brand-hover);
}
.btn-primary:active {
  background: var(--color-brand-active);
}
.btn-primary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
}
.footer {
  margin-top: 24px;
  text-align: center;
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-tertiary);
}
</style>
</head>
<body>
<div class="card">
  <div class="brand">
    <div class="brand-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    </div>
  </div>
  <h1>DSH Bridge</h1>
  <p class="subtitle">请输入密码访问</p>
  ${errHtml}
  <form method="POST" action="${LOGIN_PATH}">
    <div class="field">
      <label for="password">密码</label>
      <input type="password" id="password" name="password" placeholder="••••••••" autofocus required>
    </div>
    <button type="submit" class="btn-primary">进入</button>
  </form>
  <div class="footer">DSH Proxy Bridge</div>
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
