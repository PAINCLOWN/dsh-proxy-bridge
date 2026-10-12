/**
 * The reverse-proxy bridge: a `node:http(s)` server that forwards every request
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
 * - Sessions are revocable: each carries a random id, so signing out retires
 *   exactly that session; a password change bumps the epoch and kills all.
 * - Rate limiting protects the login path from brute-force attacks.
 * - Optional TLS: self-signed certificate for direct HTTPS access.
 *
 * @module @riceawa/dsh-proxy-bridge/proxy
 */

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import crypto from 'node:crypto'
import { randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import {
  classifySource,
  RateLimiter,
  signCookie,
  verifySession,
  type SourceClass,
} from './auth.ts'
import {
  type BridgeState,
  verifyPassword,
  revokeSession,
  isSessionRevoked,
  saveState,
} from './state.ts'
import {
  LOGIN_PATH,
  LOGOUT_PATH,
  readBody,
  serveLoginGet,
  serveLoginError,
  serveRateLimited,
} from './login.ts'
import type { TlsMaterial } from './tls.ts'

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
  /** DSH browser-session secret (base64url) for auto-injecting DSH auth cookies. */
  dshSecret?: string
  /** Whether the ingress is encrypted (self TLS or a declared trusted terminator); adds `Secure` to cookies. */
  secureCookies: boolean
  /** PEM cert/key material; when present the listener speaks HTTPS (and sends HSTS). */
  tls?: TlsMaterial
  /** LAN CIDRs that may be treated as trusted (descriptive; see `lanPasswordless`). */
  lanCidrs: readonly string[]
  /** Whether LAN/loopback sources may skip the gateway login (explicit opt-in). */
  lanPasswordless: boolean
  /** Optional injectable source classifier (integration tests emulate LAN/internet). */
  classifySource?: (req: http.IncomingMessage) => SourceClass
  /** Persistent state (cookie secret, password hash, session epoch). */
  state: BridgeState
  /** Called after the bridge revokes a session itself (sign-out), so the plugin can persist state. */
  onStateChange?: (state: BridgeState) => void
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

// --- DSH auth cookie generation ---

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Buffer {
  let s = str.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Buffer.from(s, 'base64')
}

/** DSH cookie name: `dsh-auth-` + base64url(sha256(authority)). */
function dshCookieName(authority: string): string {
  return 'dsh-auth-' + base64url(crypto.createHash('sha256').update(authority).digest())
}

/** Encode a DSH browser-session cookie: `v1.<base64url(JSON)>.<base64url(HMAC)>`. */
function dshEncodeCookie(payload: Record<string, unknown>, secretB64: string): string {
  const secret = base64urlDecode(secretB64)
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = base64url(crypto.createHmac('sha256', secret).update(body).digest())
  return `v1.${body}.${sig}`
}

/** Generate a DSH auth cookie for the given authority and secret. */
export function generateDshCookie(dshPort: number, secretB64: string): string {
  const authority = `127.0.0.1:${dshPort}`
  const now = Date.now()
  const maxAge = 30 * 86400 * 1000
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + maxAge }
  const value = dshEncodeCookie(payload, secretB64)
  return `${dshCookieName(authority)}=${value}`
}

/** Check if a request already carries a DSH auth cookie. */
function hasDshCookie(req: http.IncomingMessage): boolean {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return false
  return /dsh-auth-/.test(cookieHeader)
}

// --- Cookie helpers ---

/** Build the Set-Cookie header for a bridge session. */
function sessionCookie(
  name: string,
  value: string,
  maxAgeDays: number,
  secure: boolean,
): string {
  const maxAge = maxAgeDays * 86400
  const attrs = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  return secure ? `${attrs}; Secure` : attrs
}

/** Extract a cookie value by name from a Cookie header. */
function cookieValue(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/**
 * The bridge proxy server. Forwards HTTP requests and relays WebSocket
 * upgrades to the loopback DSH server. No same-site fence — the upstream
 * terminator (nginx) is trusted for access control.
 */
export class ProxyBridge {
  private server: http.Server | https.Server | null = null
  private config: ProxyConfig
  private running = false
  private readonly rateLimiter = new RateLimiter(5, 60_000)

  constructor(config: ProxyConfig) {
    this.config = config
  }

  /** Start listening. Resolves when the server is bound. */
  async listen(): Promise<void> {
    if (this.running) return
    this.running = true

    const { port, dshPort, secureCookies, tls } = this.config

    const server = tls
      ? https.createServer({ cert: tls.cert, key: tls.key }, (req, res) => this.handleHttp(req, res))
      : http.createServer((req, res) => this.handleHttp(req, res))

    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head)
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    this.server = server
  }

  /** Stop listening. Resolves when the server has closed. */
  async close(): Promise<void> {
    if (!this.server) return
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

  /** The bound port (useful when port 0 was requested). */
  get address(): net.AddressInfo | null {
    return this.server?.address() ?? null
  }

  // --- Auth helpers ---

  private sourceOf(req: http.IncomingMessage): SourceClass {
    const classifier = this.config.classifySource
    if (classifier !== undefined) return classifier(req)
    return classifySource(req.socket.remoteAddress, this.config.lanCidrs)
  }

  private hasValidAuth(req: http.IncomingMessage): boolean {
    const { state, cookieName, secureCookies } = this.config
    const cookieHeader = req.headers.cookie
    if (!cookieHeader) return false
    const value = cookieValue(cookieHeader, cookieName)
    if (value === undefined) return false
    const claims = verifySession(state.cookieSecret, value, Date.now(), state.sessionEpoch)
    if (claims === undefined) return false
    if (isSessionRevoked(state, claims.sid)) return false
    return true
  }

  private requiresLogin(req: http.IncomingMessage): boolean {
    if (this.config.password === undefined) return false
    const source = this.sourceOf(req)
    if (source === 'loopback' || source === 'lan') {
      if (this.config.lanPasswordless) return false
    }
    return true
  }

  // --- HTTP handler ---

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const url = new URL(req.url ?? '/', 'http://bridge.invalid')
      const path = url.pathname

      // HSTS for HTTPS listeners.
      if (this.config.tls !== undefined) {
        res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains')
      }

      // Login GET.
      if (path === LOGIN_PATH && req.method === 'GET') {
        serveLoginGet(res)
        return
      }

      // Login POST.
      if (path === LOGIN_PATH && req.method === 'POST') {
        this.handleLogin(req, res)
        return
      }

      // Logout.
      if (path === LOGOUT_PATH && req.method === 'POST') {
        this.handleLogout(req, res)
        return
      }

      // Everything else requires a valid session.
      if (this.requiresLogin(req) && !this.hasValidAuth(req)) {
        serveLoginGet(res)
        return
      }

      // Forward to DSH.
      this.forwardToDsh(req, res)
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' })
      }
      res.end(`Internal error: ${(err as Error).message}`)
    }
  }

  private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const source = this.sourceOf(req)
    const key = req.socket.remoteAddress ?? 'unknown'

    if (!this.rateLimiter.allow(key)) {
      serveRateLimited(res)
      return
    }

    const body = await readBody(req, 4096, res)
    if (body === undefined) return

    const params = new URLSearchParams(body)
    const submitted = params.get('password') ?? ''
    const { state, cookieName, cookieMaxAgeDays, secureCookies } = this.config

    const password = this.config.password
    if (password !== undefined && await verifyPassword(state, submitted)) {
      const sid = randomBytes(16).toString('base64url')
      const maxAgeMs = cookieMaxAgeDays * 86400 * 1000
      const value = signCookie(state.cookieSecret, Date.now() + maxAgeMs, state.sessionEpoch, sid)
      res.writeHead(302, {
        location: '/',
        'set-cookie': sessionCookie(cookieName, value, cookieMaxAgeDays, secureCookies),
      })
      res.end()
    } else {
      serveLoginError(res, '密码错误')
    }
  }

  private handleLogout(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { state, cookieName, secureCookies } = this.config
    const cookieHeader = req.headers.cookie
    if (cookieHeader) {
      const value = cookieValue(cookieHeader, cookieName)
      if (value !== undefined) {
        const claims = verifySession(state.cookieSecret, value, Date.now(), state.sessionEpoch)
        if (claims?.sid !== undefined) {
          const newState = revokeSession(state, claims.sid, claims.exp)
          this.config.onStateChange?.(newState)
        }
      }
    }
    res.writeHead(302, {
      location: LOGIN_PATH,
      'set-cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`,
    })
    res.end()
  }

  // --- Forward to DSH ---

  private forwardToDsh(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { dshPort, dshSecret } = this.config

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const headers = buildUpstreamHeaders(req.headers, dshPort, false)

      // Inject DSH auth cookie if the client doesn't already have one.
      if (dshSecret && !hasDshCookie(req)) {
        const dshCookie = generateDshCookie(dshPort, dshSecret)
        headers.cookie = headers.cookie ? `${headers.cookie}; ${dshCookie}` : dshCookie
      }

      if (body.length > 0) {
        headers['content-length'] = String(body.length)
      }

      const upstreamReq = http.request(
        {
          hostname: '127.0.0.1',
          port: dshPort,
          path: req.url ?? '/',
          method: req.method,
          headers,
        },
        (upstreamRes) => {
          const resHeaders: OutgoingHttpHeaders = { ...upstreamRes.headers }
          delete resHeaders['transfer-encoding']
          res.writeHead(upstreamRes.statusCode ?? 502, resHeaders)
          upstreamRes.pipe(res)
        },
      )
      upstreamReq.on('error', (err: Error) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' })
        }
        res.end(`Bad Gateway: ${err.message}`)
      })
      if (body.length > 0) upstreamReq.write(body)
      upstreamReq.end()
    })
  }

  // --- WebSocket upgrade relay ---

  private handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    try {
      if (this.requiresLogin(req) && !this.hasValidAuth(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.end()
        return
      }

      const { dshPort, dshSecret } = this.config
      const headers = buildUpstreamHeaders(req.headers, dshPort, true)

      // Inject DSH auth cookie for WS upgrades.
      if (dshSecret && !hasDshCookie(req)) {
        const dshCookie = generateDshCookie(dshPort, dshSecret)
        headers.cookie = headers.cookie ? `${headers.cookie}; ${dshCookie}` : dshCookie
      }

      // Build the raw upgrade request.
      const rawHeaders = Object.entries(headers)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\r\n')
      const requestLine = `${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1\r\n${rawHeaders}\r\n\r\n`

      const upstream = net.connect({ host: '127.0.0.1', port: dshPort })

      upstream.on('connect', () => {
        upstream.write(requestLine)
        if (head.length > 0) upstream.write(head)
      })

      // Buffer the upstream's first response to inspect the status line.
      let buf = Buffer.alloc(0)
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk])
        const headerEnd = buf.indexOf('\r\n\r\n')
        if (headerEnd === -1) return

        const headerBlock = buf.slice(0, headerEnd).toString()
        const statusLine = headerBlock.split('\r\n')[0]
        const statusCode = parseInt(statusLine.split(' ')[1] ?? '0', 10)
        upstream.removeListener('data', onData)

        if (statusCode === 101) {
          // Forward the complete 101 response (headers + any body) to the client,
          // then splice the sockets for bidirectional relay.
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
    } catch (err) {
      if (!socket.destroyed) {
        socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n')
        socket.end()
      }
    }
  }
}
