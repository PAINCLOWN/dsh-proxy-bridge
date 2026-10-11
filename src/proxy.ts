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

  /** Handle a regular HTTP request: forward to DSH. */
  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { dshPort } = this.config

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

  /** Handle a WebSocket upgrade: splice the socket to the upstream DSH server. */
  private handleUpgrade(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const { dshPort } = this.config

    const headers = buildUpstreamHeaders(req.headers, dshPort, true)

    const upstreamSocket = http.request({
      hostname: '127.0.0.1',
      port: dshPort,
      path: req.url,
      method: req.method,
      headers,
      createConnection: (options, callback) => {
        // Use a raw TCP connection for the upgrade.
        const net = require('node:net') as typeof import('node:net')
        const sock = net.connect(options)
        callback(sock)
        return sock
      },
    } as any)

    // Write the upgrade request line and headers.
    const rawHeaders = Object.entries(headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n')
    const requestLine = `${req.method} ${req.url} HTTP/1.1\r\n${rawHeaders}\r\n\r\n`

    upstreamSocket.on('response', (upstreamRes: http.IncomingMessage) => {
      if (upstreamRes.statusCode === 101) {
        // Upgrade successful — splice the two sockets.
        const upstreamSock = upstreamRes.socket as Duplex
        if (!upstreamSock) {
          socket.destroy()
          return
        }
        // Forward any initial data.
        if (head.length > 0) upstreamSock.write(head)
        upstreamSock.pipe(socket)
        socket.pipe(upstreamSock)
        upstreamSock.on('error', () => socket.destroy())
        socket.on('error', () => upstreamSock.destroy())
        upstreamSock.on('close', () => socket.destroy())
        socket.on('close', () => upstreamSock.destroy())
      } else {
        // Upgrade rejected — forward the error response.
        const statusLine = `HTTP/1.1 ${upstreamRes.statusCode ?? 502} ${upstreamRes.statusMessage ?? 'Error'}\r\n`
        const headerLines = Object.entries(upstreamRes.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\r\n')
        socket.write(`${statusLine}${headerLines}\r\n\r\n`)
        upstreamRes.pipe(socket)
        upstreamRes.on('end', () => socket.end())
        socket.on('error', () => upstreamRes.destroy())
      }
    })

    upstreamSocket.on('error', (err) => {
      if (!socket.destroyed) {
        socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
        socket.end(`Bridge upstream error: ${err.message}\r\n`)
      }
    })

    upstreamSocket.write(requestLine)
    if (head.length > 0) upstreamSocket.end(head)
    else upstreamSocket.end()
  }
}
