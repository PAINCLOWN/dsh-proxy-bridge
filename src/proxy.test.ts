/**
 * Unit tests for the proxy bridge core logic.
 *
 * Run with: node --experimental-strip-types --test src/proxy.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUpstreamHeaders,
} from './proxy'
import {
  signCookie,
  verifySession,
  RateLimiter,
  classifySource,
  parseIpv4,
} from './auth'
import type { BridgeState } from './state'

// --- Cookie sign/verify ---

describe('cookie sign/verify', () => {
  const secret = 'test-secret-key-for-hmac-signing'
  const state: BridgeState = {
    cookieSecret: secret,
    password: undefined,
    sessionEpoch: 1,
    revokedSessions: {},
  }

  it('signs and verifies a valid session', () => {
    const value = signCookie(secret, Date.now() + 3600_000, 1)
    const claims = verifySession(secret, value, Date.now(), 1)
    assert.ok(claims)
  })

  it('rejects a tampered cookie', () => {
    const value = signCookie(secret, Date.now() + 3600_000, 1)
    const tampered = value.slice(0, -2) + 'xx'
    const claims = verifySession(secret, tampered, Date.now(), 1)
    assert.equal(claims, undefined)
  })

  it('rejects an expired session', () => {
    const value = signCookie(secret, Date.now() - 1000, 1)
    const claims = verifySession(secret, value, Date.now(), 1)
    assert.equal(claims, undefined)
  })

  it('rejects a cookie from a different epoch', () => {
    const value = signCookie(secret, Date.now() + 3600_000, 1)
    const claims = verifySession(secret, value, Date.now(), 2)
    assert.equal(claims, undefined)
  })

  it('rejects a cookie with a different secret', () => {
    const value = signCookie(secret, Date.now() + 3600_000, 1)
    const claims = verifySession('different-secret', value, Date.now(), 1)
    assert.equal(claims, undefined)
  })
})

// --- Rate limiter ---

describe('rate limiter', () => {
  it('allows requests within the limit', () => {
    const limiter = new RateLimiter(3, 60_000)
    assert.equal(limiter.allow('test'), true)
    assert.equal(limiter.allow('test'), true)
    assert.equal(limiter.allow('test'), true)
  })

  it('blocks requests exceeding the limit', () => {
    const limiter = new RateLimiter(2, 60_000)
    assert.equal(limiter.allow('test'), true)
    assert.equal(limiter.allow('test'), true)
    assert.equal(limiter.allow('test'), false)
  })

  it('tracks different keys independently', () => {
    const limiter = new RateLimiter(1, 60_000)
    assert.equal(limiter.allow('a'), true)
    assert.equal(limiter.allow('a'), false)
    assert.equal(limiter.allow('b'), true)
  })
})

// --- CIDR matching ---

describe('CIDR matching', () => {
  it('parses IPv4 addresses', () => {
    const ip = parseIpv4('192.168.1.1')
    assert.equal(ip, 0xc0a80101)
  })

  it('classifies loopback addresses', () => {
    const source = classifySource('127.0.0.1', [])
    assert.equal(source, 'loopback')
  })

  it('classifies LAN addresses', () => {
    const source = classifySource('192.168.1.100', ['192.168.0.0/16'])
    assert.equal(source, 'lan')
  })

  it('classifies internet addresses', () => {
    const source = classifySource('8.8.8.8', ['192.168.0.0/16'])
    assert.equal(source, 'internet')
  })
})

// --- Header rewrite ---

describe('buildUpstreamHeaders', () => {
  it('rewrites Host and Origin to the DSH port', () => {
    const headers = buildUpstreamHeaders(
      { host: 'example.com', origin: 'https://example.com' },
      3080,
      false,
    )
    assert.equal(headers.host, '127.0.0.1:3080')
    assert.equal(headers.origin, 'http://127.0.0.1:3080')
  })

  it('strips hop-by-hop headers', () => {
    const headers = buildUpstreamHeaders(
      { connection: 'keep-alive', upgrade: 'websocket', keepalive: 'timeout=5' },
      3080,
      false,
    )
    assert.equal(headers.connection, undefined)
    assert.equal(headers.upgrade, undefined)
    assert.equal(headers.keepalive, undefined)
  })

  it('keeps upgrade headers when keepUpgrade is true', () => {
    const headers = buildUpstreamHeaders(
      { connection: 'upgrade', upgrade: 'websocket' },
      3080,
      true,
    )
    assert.equal(headers.connection, 'upgrade')
    assert.equal(headers.upgrade, 'websocket')
  })

  it('strips forwarding headers', () => {
    const headers = buildUpstreamHeaders(
      {
        'x-forwarded-for': '1.2.3.4',
        'x-forwarded-proto': 'https',
        'x-real-ip': '5.6.7.8',
      },
      3080,
      false,
    )
    assert.equal(headers['x-forwarded-for'], undefined)
    assert.equal(headers['x-forwarded-proto'], undefined)
    assert.equal(headers['x-real-ip'], undefined)
  })

  it('preserves regular headers', () => {
    const headers = buildUpstreamHeaders(
      { 'content-type': 'application/json', accept: 'text/html' },
      3080,
      false,
    )
    assert.equal(headers['content-type'], 'application/json')
    assert.equal(headers.accept, 'text/html')
  })
})
