/**
 * Persistent runtime state for the proxy bridge: the cookie-signing secret and
 * the scrypt password hash. Lives in `~/.dsh/proxy-bridge/state.json` (0600).
 *
 * @module @painclown/dsh-proxy-bridge/state
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'

/** The state directory: `~/.dsh/proxy-bridge`. */
export function stateDir(home: string = homedir()): string {
  return join(home, '.dsh', 'proxy-bridge')
}

export interface PasswordRecord {
  /** Hex scrypt-derived key. */
  hash: string
  /** Hex salt. */
  salt: string
}

export interface BridgeState {
  /** Base64 cookie-signing secret (32 random bytes). */
  cookieSecret: string
  /** scrypt password record, absent when no password is set. */
  password?: PasswordRecord
  /**
   * Session revocation epoch. Every issued login cookie carries the epoch it
   * was signed under; a cookie whose epoch differs from the current one is
   * rejected. Setting or clearing the password increments the epoch.
   */
  sessionEpoch: number
  /**
   * Revoked session ids, each mapped to the epoch millis at which that
   * session's own cookie expires.
   */
  revokedSessions?: Record<string, number>
}

const STATE_FILENAME = 'state.json'

function deriveKey(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (error, derived) => {
      if (error !== null) reject(error)
      else resolve(derived)
    })
  })
}

/**
 * Whether a password is present and passes scrypt verification.
 */
export async function verifyPassword(state: BridgeState, password: string): Promise<boolean> {
  if (state.password === undefined) return false
  const { hash, salt } = state.password
  try {
    const expected = Buffer.from(hash, 'hex')
    const actual = await deriveKey(password, Buffer.from(salt, 'hex'), expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/**
 * Set (or clear) the password, re-salted on every write. Bumps the session
 * epoch so every previously issued session dies immediately.
 */
export async function setPassword(state: BridgeState, password: string | undefined): Promise<BridgeState> {
  const base: BridgeState = {
    cookieSecret: state.cookieSecret,
    sessionEpoch: state.sessionEpoch + 1,
  }
  if (password === undefined) return base
  const salt = randomBytes(16)
  const hash = await deriveKey(password, salt, 64)
  return {
    ...base,
    password: { hash: hash.toString('hex'), salt: salt.toString('hex') },
  }
}

/**
 * Record a session id as revoked.
 */
export function revokeSession(
  state: BridgeState,
  sid: string,
  expiresMs: number,
  now: number = Date.now(),
): BridgeState {
  const revoked: Record<string, number> = {}
  for (const [id, exp] of Object.entries(state.revokedSessions ?? {})) {
    if (exp > now) revoked[id] = exp
  }
  revoked[sid] = expiresMs
  return { ...state, revokedSessions: revoked }
}

/** Whether `sid` names a session that has been signed out. */
export function isSessionRevoked(state: BridgeState, sid: string | undefined): boolean {
  if (sid === undefined) return false
  return Object.hasOwn(state.revokedSessions ?? {}, sid)
}

function defaultState(): BridgeState {
  return { cookieSecret: randomBytes(32).toString('base64'), sessionEpoch: 0 }
}

function parseRevokedSessions(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const now = Date.now()
  const out: Record<string, number> = {}
  let anyLive = false
  for (const [sid, exp] of Object.entries(raw)) {
    if (typeof exp === 'number' && Number.isFinite(exp) && exp > now) {
      out[sid] = exp
      anyLive = true
    }
  }
  return anyLive ? out : undefined
}

/** Load state; on first run (or a corrupt file) generate a fresh secret. */
export function loadState(home: string = homedir()): BridgeState {
  const dir = stateDir(home)
  try {
    const raw = readFileSync(join(dir, STATE_FILENAME), 'utf8')
    const parsed = JSON.parse(raw) as Partial<BridgeState>
    if (typeof parsed?.cookieSecret === 'string' && parsed.cookieSecret.length >= 16) {
      const sessionEpoch = typeof parsed.sessionEpoch === 'number' && Number.isSafeInteger(parsed.sessionEpoch)
        ? parsed.sessionEpoch
        : 0
      const base: BridgeState = { cookieSecret: parsed.cookieSecret, sessionEpoch }
      if (parsed.password !== undefined) base.password = parsed.password
      const revoked = parseRevokedSessions(parsed.revokedSessions)
      if (revoked !== undefined) base.revokedSessions = revoked
      return base
    }
    return defaultState()
  } catch {
    return defaultState()
  }
}

/** Persist state atomically. */
export function saveState(state: BridgeState, home: string = homedir()): void {
  const dir = stateDir(home)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, STATE_FILENAME)
  const tmp = join(dir, `.state.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  renameSync(tmp, target)
  try {
    chmodSync(target, 0o600)
  } catch {}
}
