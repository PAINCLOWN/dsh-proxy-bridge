/**
 * Authentication primitives for the proxy bridge: source-IP classification
 * (loopback / lan / internet), HMAC-signed session cookies, and an in-memory
 * per-source login rate limiter.
 *
 * @module @painclown/dsh-proxy-bridge/auth
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** The three trust tiers a request source can fall into. */
export type SourceClass = 'loopback' | 'lan' | 'internet'

/** One CIDR range: an IPv4 address and its prefix length. */
interface Cidr {
  addr: number
  prefix: number
}

const DEFAULT_LAN_CIDRS: readonly string[] = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
]

/** Parse a dotted-quad IPv4 string to its 32-bit integer, or undefined. */
export function parseIpv4(text: string): number | undefined {
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  let out = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const byte = Number(part)
    if (byte > 255) return undefined
    out = (out << 8) | byte
  }
  return out >>> 0
}

/** Parse `a.b.c.d/len` into a Cidr, or undefined on malformed input. */
function parseCidr(text: string): Cidr | undefined {
  const slash = text.indexOf('/')
  const addrText = slash === -1 ? text : text.slice(0, slash)
  const prefixText = slash === -1 ? '32' : text.slice(slash + 1)
  const addr = parseIpv4(addrText)
  if (addr === undefined) return undefined
  if (!/^\d{1,2}$/.test(prefixText)) return undefined
  const prefix = Number(prefixText)
  if (prefix < 0 || prefix > 32) return undefined
  return { addr, prefix }
}

/** Whether a 32-bit IPv4 address falls inside one CIDR range. */
function inCidr(ip: number, cidr: Cidr): boolean {
  if (cidr.prefix === 0) return true
  const mask = cidr.prefix === 32 ? 0xffffffff : (0xffffffff << (32 - cidr.prefix)) >>> 0
  return (ip & mask) === (cidr.addr & mask)
}

function normalizeAddress(raw: string): string {
  const value = raw.trim()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (mapped !== null) return mapped[1]!
  return value
}

/**
 * Classify a source address into one of the three trust tiers.
 */
export function classifySource(
  remoteAddress: string | undefined,
  lanCidrs: readonly string[] = DEFAULT_LAN_CIDRS,
): SourceClass {
  const address = normalizeAddress(remoteAddress ?? '')
  if (address === '') return 'internet'

  const ipv4 = parseIpv4(address)
  if (ipv4 !== undefined) {
    if (ipv4 >>> 24 === 127) return 'loopback'
    for (const cidrText of lanCidrs) {
      const cidr = parseCidr(cidrText)
      if (cidr !== undefined && inCidr(ipv4, cidr)) return 'lan'
    }
    return 'internet'
  }

  if (address === '::1') return 'loopback'
  if (inIpv6LinkLocal(address)) return 'lan'
  return 'internet'
}

function inIpv6LinkLocal(address: string): boolean {
  const match = /^([0-9a-fA-F]{1,4}):/.exec(address)
  if (match === null) return false
  return (Number.parseInt(match[1]!, 16) & 0xffc0) === 0xfe80
}

// --- Session cookie signing ---

function base64url(input: Buffer): string {
  return input.toString('base64url')
}

/** The claims a verified session cookie carries. */
export interface SessionClaims {
  /** Epoch millis at which the session expires. */
  exp: number
  /** The revocation epoch the cookie was minted under. */
  epoch: number
  /** Per-session id for individual revocation. */
  sid?: string
}

/**
 * Issue a signed session cookie value: `payload.signature`.
 */
export function signCookie(secret: string, expiresMs: number, epoch: number = 0, sid?: string): string {
  const claims = sid === undefined ? { exp: expiresMs, epoch } : { exp: expiresMs, epoch, sid }
  const payload = base64url(Buffer.from(JSON.stringify(claims)))
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/**
 * Verify a cookie's signature, expiry, and epoch.
 * @returns the claims it carries, or undefined when invalid.
 */
export function verifySession(
  secret: string,
  value: string | undefined,
  now: number,
  epoch: number = 0,
): SessionClaims | undefined {
  if (value === undefined) return undefined
  const dot = value.indexOf('.')
  if (dot === -1) return undefined
  const payload = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(sig, 'base64url')
  } catch {
    return undefined
  }
  if (expected.length !== actual.length) return undefined
  if (!timingSafeEqual(expected, actual)) return undefined
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SessionClaims>
    if (typeof decoded.exp !== 'number' || decoded.exp <= now) return undefined
    const cookieEpoch = typeof decoded.epoch === 'number' ? decoded.epoch : 0
    if (cookieEpoch !== epoch) return undefined
    return {
      exp: decoded.exp,
      epoch: cookieEpoch,
      ...(typeof decoded.sid === 'string' ? { sid: decoded.sid } : {}),
    }
  } catch {
    return undefined
  }
}

// --- Rate limiter ---

/** A token bucket limiter keyed by source address. */
export class RateLimiter {
  private static readonly MAX_BUCKETS = 10_000
  private readonly buckets = new Map<string, { tokens: number; resetAt: number }>()
  private nextPruneAt = 0

  constructor(
    private readonly maxTokens: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Attempt to consume one token for `key`.
   * @returns true when allowed, false when rate-limited.
   */
  allow(key: string): boolean {
    const now = Date.now()
    if (now >= this.nextPruneAt) {
      this.prune(now)
      this.nextPruneAt = now + this.windowMs
    }
    const existing = this.buckets.get(key)
    if (existing !== undefined && existing.resetAt > now) {
      if (existing.tokens <= 0) return false
      existing.tokens -= 1
      return true
    }
    if (existing === undefined && this.buckets.size >= RateLimiter.MAX_BUCKETS) {
      this.evictSoonestToExpire()
    }
    this.buckets.set(key, { tokens: this.maxTokens - 1, resetAt: now + this.windowMs })
    return true
  }

  private prune(now: number = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key)
    }
  }

  private evictSoonestToExpire(): void {
    const target = Math.floor(RateLimiter.MAX_BUCKETS * 0.9)
    const byExpiry = [...this.buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    for (const [key] of byExpiry.slice(0, Math.max(0, this.buckets.size - target))) {
      this.buckets.delete(key)
    }
  }
}
