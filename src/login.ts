/**
 * Login page rendering and login/logout path handling for the proxy bridge.
 *
 * @module @riceawa/dsh-proxy-bridge/login
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
    ? `<div style="color:#e55;margin-bottom:12px">${escapeHtml(error)}</div>`
    : ''
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Bridge</title>
<style>
body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;font-family:system-ui,sans-serif}
.card{background:#16213e;padding:40px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);width:320px;text-align:center}
h1{color:#e94560;font-size:22px;margin:0 0 8px}
p{color:#a0a0b0;font-size:13px;margin:0 0 24px}
input{width:100%;padding:10px 14px;border:1px solid #0f3460;border-radius:6px;background:#0f3460;color:#fff;font-size:14px;box-sizing:border-box;margin-bottom:16px}
input:focus{outline:none;border-color:#e94560}
button{width:100%;padding:10px;background:#e94560;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer}
button:hover{background:#c73650}
</style>
</head>
<body>
<div class="card">
<h1>DSH Bridge</h1>
<p>请输入密码访问</p>
${errHtml}
<form method="POST" action="${LOGIN_PATH}">
<input type="password" name="password" placeholder="密码" autofocus required>
<button type="submit">进入</button>
</form>
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
