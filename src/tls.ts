/**
 * Self-signed TLS certificate management for the proxy bridge.
 *
 * @module @painclown/dsh-proxy-bridge/tls
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { stateDir } from './state.ts'

/** PEM cert/key material for an HTTPS listener. */
export interface TlsMaterial {
  cert: string
  key: string
}

const SELF_SIGNED_CERT_FILE = 'selfsigned.crt'
const SELF_SIGNED_KEY_FILE = 'selfsigned.key'

function privateWrite(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {}
}

/**
 * Load the persisted self-signed certificate, generating it on first use.
 */
export function loadOrCreateSelfSigned(
  opts: { hosts: readonly string[]; days: number; commonName?: string },
  home: string = homedir(),
): { material: TlsMaterial; created: boolean } {
  const dir = stateDir(home)
  const certPath = join(dir, SELF_SIGNED_CERT_FILE)
  const keyPath = join(dir, SELF_SIGNED_KEY_FILE)
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = readFileSync(certPath, 'utf8')
      const key = readFileSync(keyPath, 'utf8')
      if (cert.length > 0 && key.length > 0) {
        return { material: { cert, key }, created: false }
      }
    } catch {
      // Fall through to regeneration.
    }
  }

  mkdirSync(dir, { recursive: true })
  const cn = opts.commonName ?? (opts.hosts[0] ?? 'localhost')
  const alt = opts.hosts.length > 0 ? `subjectAltName=${opts.hosts.map((h) => `DNS:${h}`).join(',')}` : ''
  const args = [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath, '-out', certPath,
    '-days', String(opts.days),
    '-nodes',
    '-subj', `/CN=${cn}`,
  ]
  if (alt) args.push('-extensions', 'v3_ext', '-config', `(dn) [dn]\n[req]\ndistinguished_name=dn\n[ v3_ext ]\n${alt}`)

  try {
    execFileSync('openssl', args, { stdio: 'pipe' })
  } catch (err) {
    throw new Error(`Failed to generate self-signed certificate: ${(err as Error).message}`)
  }

  const cert = readFileSync(certPath, 'utf8')
  const key = readFileSync(keyPath, 'utf8')
  privateWrite(keyPath, key)
  privateWrite(certPath, cert)
  return { material: { cert, key }, created: true }
}
