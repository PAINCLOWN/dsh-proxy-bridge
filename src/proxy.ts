/**
 * The reverse-proxy bridge: a `node:http` server that forwards every request
 * to the loopback DSH web server. Designed to sit behind a TLS-terminating
 * reverse proxy (nginx), so it skips the strict same-site Origin/Host fence
 * that breaks WebSocket upgrades through nginx → gateway → DSH chains.
 *
 * Security model:
 * - Trusts the upstream terminator (nginx) for security. The bridge itself
 *   does NOT enforce same-site checks — nginx (or the CDN in front of it)
 *   is responsible for access control.
 * - Optional password gate: when a password is set, every request must carry
 *   a valid session cookie. This is a second layer on top of nginx's auth.
 * - The bridge rewrites Host/Origin to the loopback DSH port so the upstream
 *   sees requests as if they came from localhost.
 *
 * @module @riceawa/dsh-proxy-bridge/proxy
 */

import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import type { Duplex } from 'node:stream'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'

/** Configuration the proxy needs at listen time. */
export interface ProxyConfig {
  /** Port to bind on (0.0.0.0, dual-stack). */
  port: number
  /** The loopback DSH web server port to forward to. */
  dshPort: number
  /** Optional password for the bridge's own session gate. */
  password?: string
  /** Cookie name for the bridge session. */
  cookieName: string
  /** Cookie lifetime in days. */
  cookieMaxAgeDays: number
}

/** Hop-by-hop headers a proxy must not forward (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
])

/** Forwarding headers from the upstream proxy — drop them, we re-derive. */
const FORWARDING_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
]

/**
 * Build the outbound headers for one relayed request: rewrite Host/Origin to
 * the loopback DSH port, drop hop-by-hop and caller-supplied forwarding headers.
 *
 * Unlike the LAN gateway, this does NOT strip the upstream session cookie
 * namespace — the bridge doesn't relay a shared upstream session. The DSH
 * server's own session cookie passes through as-is.
 */
export function buildUpstreamHeaders(
  headers: IncomingHttpHeaders,
  dshPort: number,
  keepUpgrade: boolean,
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = { ...headers }
  out.host = `127.0.0.1:${dshPort}`
  if (typeof out.origin === 'string') {
    out.origin = `http://127.0.0.1:${dshPort}`
  }
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

/**
 * The bridge proxy server. Forwards HTTP requests and relays WebSocket
 * upgrades to the loopback DSH server. No same-site fence — the upstream
 * terminator (nginx) is trusted for access control.
 */
export class ProxyBridge {
  private server: http.Server | null = null
  private config: ProxyConfig
  private running = false

  constructor(config: ProxyConfig) {
    this.config = config
  }

  /** Start listening. Resolves when the server is bound. */
  async listen(): Promise<void> {
    if (this.running) return
    this.running = true

    const { port, dshPort } = this.config

    this.server = http.createServer((req, res) => {
      this.handleHttp(req, res)
    })

    this.server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head)
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(port, '0.0.0.0', () => {
        this.server!.removeListener('error', reject)
        resolve()
      })
    })
  }

  /** Stop listening and close all connections. */
  async close(): Promise<void> {
    if (!this.running || !this.server) return
    this.running = false
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve())
    })
    this.server = null
  }

  /** Whether the server is currently listening. */
  get isRunning(): boolean {
    return this.running
  }

  /** Generate an auth cookie value from the password. */
  private signCookie(password: string): string {
    const secret = `dsh-proxy-bridge:${password}`
    return crypto.createHmac('sha256', secret).update('bridge-session').digest('hex')
  }

  /** Check if the request carries a valid auth cookie. */
  private hasValidAuth(req: http.IncomingMessage): boolean {
    const { password, cookieName } = this.config
    if (!password) return true // No password set — open access.
    const cookieHeader = req.headers.cookie
    if (!cookieHeader) return false
    const cookies = new URLSearchParams(cookieHeader.split(';').map((c) => c.trim().replace(/^.*?=/, '')).join('&'))
    // Simpler: parse manually
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`))
    if (!match) return false
    const expected = this.signCookie(password)
    const provided = match[1]
    if (provided.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  }

  /** Serve the login page. */
  private serveLoginPage(res: http.ServerResponse, error?: string): void {
    const errHtml = error ? `<div style="color:#e55;margin-bottom:12px">${error}</div>` : ''
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Bridge</title>
<style>
body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;font-family:system-ui,sans-serif}
.card{background:#16213e;padding:40px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);width:320px;text-align:center}
h1{color:#e94560;font-size:22px;margin:0 0 8px}
p{color:#a0a0b0;font-size:13px;margin:0 0 24px}
input{width:100%;padding:10px 14px;border:1px solid #0f3460;border-radius:6px;background:#0f3460;color:#fff;font-size:14px;box-sizing:border-box;margin-bottom:16px}
input:focus{outline:none;border-color:#e94560}
button{width:100%;padding:10px;background:#e94560;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer}
button:hover{background:#c73650}
</style></head>
<body>
<div class="card">
<h1>DSH Bridge</h1>
<p>请输入密码访问</p>
${errHtml}
<form method="POST" action="/__bridge_login">
<input type="password" name="password" placeholder="密码" autofocus required>
<button type="submit">进入</button>
</form>
</div>
</body></html>`)
  }

  /** Handle the login POST. */
  private handleLogin(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { password, cookieName, cookieMaxAgeDays } = this.config
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      const params = new URLSearchParams(body)
      const submitted = params.get('password') ?? ''
      if (password && submitted === password) {
        const value = this.signCookie(password)
        const maxAge = cookieMaxAgeDays * 86400
        res.writeHead(302, {
          location: '/',
          'set-cookie': `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
        })
        res.end()
      } else {
        this.serveLoginPage(res, '密码错误')
      }
    })
  }

  /** Handle a regular HTTP request: auth gate, then forward to DSH. */
  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { dshPort } = this.config

    // Login endpoint
    if (req.url === '/__bridge_login' && req.method === 'POST') {
      this.handleLogin(req, res)
      return
    }

    // Auth gate
    if (!this.hasValidAuth(req)) {
      this.serveLoginPage(res)
      return
    }

    // Read the full request body.
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const headers = buildUpstreamHeaders(req.headers, dshPort, false)
      if (body.length > 0) {
        headers['content-length'] = String(body.length)
      }

      const upstreamReq = http.request(
        {
          hostname: '127.0.0.1',
          port: dshPort,
          path: req.url,
          method: req.method,
          headers,
        },
        (upstreamRes) => {
          // Filter response headers: drop set-cookie for the bridge's own
          // cookie namespace (if any), pass everything else through.
          const resHeaders: OutgoingHttpHeaders = { ...upstreamRes.headers }
          delete resHeaders['transfer-encoding']
          res.writeHead(upstreamRes.statusCode ?? 502, resHeaders)
          upstreamRes.pipe(res)
        },
      )

      upstreamReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' })
        }
        res.end(`Bad Gateway: ${err.message}`)
      })

      if (body.length > 0) upstreamReq.write(body)
      upstreamReq.end()
    })

    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(400)
      }
      res.end()
    })
  }

  /** Handle a WebSocket upgrade: auth gate, then splice the socket to upstream. */
  private handleUpgrade(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const { dshPort } = this.config

    // Auth gate for WS
    if (!this.hasValidAuth(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.end()
      return
    }

    const headers = buildUpstreamHeaders(req.headers, dshPort, true)

    // Build the raw upgrade request.
    const rawHeaders = Object.entries(headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n')
    const requestLine = `${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1\r\n${rawHeaders}\r\n\r\n`

    // Raw TCP connection to the upstream DSH server.
    const upstream = net.connect({ host: '127.0.0.1', port: dshPort })

    upstream.on('connect', () => {
      upstream.write(requestLine)
      if (head.length > 0) upstream.write(head)
    })

    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd === -1) return // Not enough data yet.

      const headerBlock = buf.slice(0, headerEnd).toString()
      const bodyStart = headerEnd + 4
      const statusLine = headerBlock.split('\r\n')[0]
      const statusCode = parseInt(statusLine.split(' ')[1] ?? '0', 10)

      // Remove the data handler so remaining data flows through the pipe.
      upstream.removeListener('data', onData)

      if (statusCode === 101) {
        // Upgrade successful — forward the full 101 response to the client,
        // then splice the two sockets for bidirectional data flow.
        socket.write(buf)
        upstream.pipe(socket)
        socket.pipe(upstream)
        upstream.on('error', () => socket.destroy())
        socket.on('error', () => upstream.destroy())
        upstream.on('close', () => socket.destroy())
        socket.on('close', () => upstream.destroy())
      } else {
        // Upgrade rejected — forward the error response.
        socket.write(buf)
        upstream.pipe(socket)
        upstream.on('end', () => socket.end())
        upstream.on('error', () => socket.destroy())
        socket.on('error', () => upstream.destroy())
      }
    }
    upstream.on('data', onData)

    upstream.on('error', (err: Error) => {
      if (!socket.destroyed) {
        socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
        socket.end(`Bridge upstream error: ${err.message}\r\n`)
      }
    })

    socket.on('error', () => {
      upstream.destroy()
    })
  }
}
